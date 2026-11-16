import { drawSwingingLantern } from '../engine/architectureGrammar';
import { MaterialRamp, RAMPS, VOID } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef, RenderContextOptions } from './types';

/**
 * ============================================================================
 * PROCEDURAL NATURE: BUSHES & DIVERSE TREE SPECIES (14 HIGH-CRAFT MODELS)
 * ============================================================================
 * Every plant follows 3/4 top-left illumination, textured bark/roots, clustered
 * volumetric leaf lobes (never flat circles), wind-phase kinematics (12f), and
 * borderless material-tone shading isolation via `buf.layer()`.
 * ============================================================================
 */

function applyOptionalGroundShadow(
  _buf: PixelBuffer,
  _cx: number,
  _cy: number,
  _rx: number,
  _ry: number,
  _ctx?: RenderContextOptions
): void {
  // Delegated to unified shape-based, stageBg-adaptive soft shadow pass in renderModelWithContext
}

/**
 * Draws a multi-toned volumetric foliage lobe with dithered leaf cluster grain.
 */
function drawLeafCluster(
  sub: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: MaterialRamp,
  seed = 1
): void {
  sub.fillEllipse(cx, cy, rx, ry, (nx, ny, px, py) => {
    const cluster = ((px * 5 + py * 3 + seed * 7) & 7) === 0;
    const tuft = ((px * 3 - py * 7 + seed * 11) & 7) === 1;
    if (ny > 0.48 || nx > 0.48) return ramp.deep;
    if (ny < -0.35 && nx < 0.25) return tuft ? ramp.mid : ramp.highlight;
    if (cluster) return ramp.shadow;
    if (tuft && nx < 0.15) return ramp.highlight;
    return ramp.mid;
  });
}

/**
 * Draws textured tree trunk with flared roots, top-left lighting, and bark furrows.
 */
function drawGnarledTrunk(
  sub: PixelBuffer,
  cx: number,
  topY: number,
  bottomY: number,
  topHalfW: number,
  rootFlare: number,
  bendFn: (p: number) => number,
  barkRamp: MaterialRamp
): void {
  const span = Math.max(1, bottomY - topY);
  for (let y = topY; y <= bottomY; y++) {
    const p = (y - topY) / span;
    const flare = p > 0.72 ? Math.pow((p - 0.72) / 0.28, 1.3) * rootFlare : 0;
    const hw = Math.max(1, Math.round(topHalfW + p * 1.5 + flare));
    const offsetX = Math.round(bendFn(p));
    for (let dx = -hw; dx <= hw; dx++) {
      const nx = dx / hw;
      const furrow = (dx * 3 + Math.floor(y / 2)) % 5 === 0;
      const px = cx + offsetX + dx;
      const c =
        nx < -0.38
          ? barkRamp.highlight
          : nx > 0.42
            ? barkRamp.deep
            : furrow
              ? barkRamp.shadow
              : barkRamp.mid;
      sub.setPixel(px, y, c);
    }
  }
}

/* ============================================================================
 * 1..6: DIVERSE BUSHES (КУСТЫ)
 * ============================================================================ */

function renderBerryBush(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(36, 32);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 0.9);
  const topSway = Math.round(Math.sin(t + 0.8) * 1.1);

  applyOptionalGroundShadow(buf, 18, 27, 13, 3, ctx);

  // Woody stems peeking under bush skirt
  buf.layer((sub) => {
    sub.drawLine(14, 22, 13, 27, RAMPS.timber.mid, 2);
    sub.drawLine(21, 22, 22, 27, RAMPS.timber.shadow, 2);
    sub.fillEllipse(18, 26, 11, 2, RAMPS.pine.deep);
  });

  // 5-lobe lush bush crown
  buf.layer((sub) => {
    drawLeafCluster(sub, 11 + sway, 20, 6.5, 5, RAMPS.moss, 1);
    drawLeafCluster(sub, 25 + sway, 20, 6.5, 5, RAMPS.pine, 2);
    drawLeafCluster(sub, 15 + sway, 15, 6.5, 5.5, RAMPS.moss, 3);
    drawLeafCluster(sub, 22 + sway, 16, 6, 5, RAMPS.moss, 4);
    drawLeafCluster(sub, 18 + topSway, 12, 7.2, 5.5, RAMPS.moss, 5);

    // Ripe ruby berries + white blossoms
    const berries = [
      [11 + sway, 19],
      [16 + topSway, 12],
      [21 + sway, 16],
      [25 + sway, 20],
      [14 + sway, 22],
    ];
    for (const [bx, by] of berries) {
      sub.fillRect(bx, by, 2, 2, RAMPS.lava.shadow);
      sub.setPixel(bx, by, '#FF6B7A');
      sub.setPixel(bx + 1, by, '#FFFFFF');
    }
    sub.setPixel(19 + topSway, 10, '#FFFFFF');
    sub.setPixel(12 + sway, 16, RAMPS.gold.highlight);
  });

  return buf;
}

function renderThornBriar(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(38, 34);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 0.9);

  applyOptionalGroundShadow(buf, 19, 29, 13, 3, ctx);

  // Dark mossy undergrowth + coiled thorny arches
  buf.layer((sub) => {
    drawLeafCluster(sub, 13, 24, 6.5, 4.5, RAMPS.pine, 2);
    drawLeafCluster(sub, 25, 24, 6.5, 4.5, RAMPS.pine, 5);
    drawLeafCluster(sub, 19 + sway, 19, 7.5, 5.5, RAMPS.pine, 3);

    // Interlocking crooked briar vines
    sub.drawRibArch(8, 28, 13 + sway, 10, 26 + sway, 16, 2, RAMPS.timber);
    sub.drawRibArch(30, 28, 24 + sway, 9, 11 + sway, 15, 2, RAMPS.timber);
    sub.drawRibArch(11, 28, 19 + sway, 16, 28, 28, 1, RAMPS.timber);

    // Sharp ivory/slate thorns jutting out
    const thorns = [
      [10, 18, -1, -1],
      [15 + sway, 12, 0, -1],
      [23 + sway, 11, 1, -1],
      [28, 19, 1, -1],
      [19 + sway, 16, 0, -1],
    ];
    for (const [tx, ty, dx, dy] of thorns) {
      sub.setPixel(tx, ty, RAMPS.bone.mid);
      sub.setPixel(tx + dx, ty + dy, RAMPS.bone.highlight);
    }

    // Swaying dark-violet nightshade buds
    const bloom = Math.sin(t * 2) > 0;
    for (const [bx, by] of [
      [13 + sway, 14],
      [24 + sway, 15],
      [19 + sway, 21],
    ]) {
      sub.fillRect(bx, by, 2, 2, RAMPS.amethyst.mid);
      sub.setPixel(bx, by, bloom ? RAMPS.amethyst.highlight : RAMPS.magenta.highlight);
    }
  });

  return buf;
}

function renderManaShrub(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(38, 36);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 1.0);
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  applyOptionalGroundShadow(buf, 19, 30, 13, 3, ctx);

  buf.layer((sub) => {
    // Silver-birch base roots
    sub.drawLine(17, 25, 14, 30, RAMPS.birch.mid, 2);
    sub.drawLine(21, 25, 24, 30, RAMPS.birch.shadow, 2);

    // Emerald & copper magic foliage dome
    drawLeafCluster(sub, 12 + sway, 23, 6.5, 4.5, RAMPS.copper, 1);
    drawLeafCluster(sub, 26 + sway, 23, 6.5, 4.5, RAMPS.emerald, 2);
    drawLeafCluster(sub, 19 + sway, 18, 8.5, 6.5, RAMPS.emerald, 4);
    drawLeafCluster(sub, 19 + sway, 13, 6, 4.5, RAMPS.copper, 6);

    // Glowing K1/K2 mana lotus blossoms
    const flowers = [
      [12 + sway, 19],
      [19 + sway, 12],
      [25 + sway, 19],
      [18 + sway, 22],
    ];
    for (const [fx, fy] of flowers) {
      sub.fillRect(fx - 1, fy, 3, 2, RAMPS.magenta.mid);
      sub.setPixel(fx, fy - 1, RAMPS.cyanMask.highlight);
      sub.setPixel(fx, fy, pulse > 0.5 ? '#FFFFFF' : RAMPS.gold.highlight);
    }
  });

  // Rising glowing pollen motes (un-outlined luminous particles)
  for (let i = 0; i < 4; i++) {
    const p = ((frame + i * 3) % total) / total;
    const px = 12 + i * 5 + Math.round(Math.sin(t + i * 1.7) * 2);
    const py = Math.round(18 - p * 13);
    buf.setPixel(px, py, i % 2 === 0 ? RAMPS.cyanMask.highlight : '#FFFFFF');
  }

  return buf;
}

function renderDesertScrub(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(38, 34);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 1.4);
  const twigTipX = Math.round(Math.sin(t + 0.7) * 1.6);
  const bloomPulse = Math.sin(t * 2);

  applyOptionalGroundShadow(buf, 19, 29, 13, 3, ctx);

  // Sandstone mound & dry sage twigs
  buf.layer((sub) => {
    sub.fillEllipse(19, 27, 11, 3, (nx, ny) =>
      ny < -0.2 ? RAMPS.sandstone.highlight : nx > 0.35 ? RAMPS.sandstone.deep : RAMPS.sandstone.mid
    );
    // Dry desert scrub twig cluster on right
    sub.drawLine(25, 27, 29 + sway, 19, RAMPS.timber.mid, 1);
    sub.drawLine(27, 24, 31 + twigTipX, 21, RAMPS.sandstone.highlight, 1);
    sub.fillRect(28 + twigTipX, 18, 3, 2, RAMPS.sandstone.highlight);

    // Sculpted prickly-pear cactus paddles
    sub.fillEllipse(16, 22, 4.5, 5, (nx, ny) =>
      nx < -0.3 || ny < -0.3 ? RAMPS.moss.highlight : nx > 0.35 ? RAMPS.pine.deep : RAMPS.moss.mid
    );
    sub.fillEllipse(11 + Math.round(sway * 0.4), 17, 3.5, 4, (nx, ny) =>
      nx < -0.3 ? RAMPS.moss.highlight : RAMPS.moss.mid
    );
    sub.fillEllipse(21 + Math.round(sway * 0.6), 16, 3.8, 4.2, (nx, ny) =>
      nx < -0.2 ? RAMPS.moss.highlight : nx > 0.35 ? RAMPS.moss.deep : RAMPS.moss.mid
    );

    // Cactus spines + golden-orange prickly pear blooms
    for (const [sx, sy] of [
      [15, 20],
      [18, 22],
      [10 + Math.round(sway * 0.4), 16],
      [21 + Math.round(sway * 0.6), 15],
    ]) {
      sub.setPixel(sx, sy, RAMPS.bone.highlight);
    }
    const leftBloomX = 11 + Math.round(sway * 0.4);
    const rightBloomX = 21 + Math.round(sway * 0.6);
    for (const [fx, fy] of [
      [leftBloomX, 12],
      [rightBloomX, 11],
      [16, 16],
    ]) {
      sub.fillRect(fx - 1, fy, 3, 2, RAMPS.lava.mid);
      sub.setPixel(fx, fy - 1, bloomPulse > 0.2 ? '#FFFFFF' : RAMPS.gold.highlight);
    }

    // Wind-rippled sand highlight traveling across dune base
    const rippleX = 12 + (frame % 12);
    sub.setPixel(rippleX, 26, '#FFF1D0');
    sub.setPixel(rippleX + 1, 27, RAMPS.sandstone.highlight);
  });

  return buf;
}

function renderFrostHolly(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(38, 34);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 0.8);

  applyOptionalGroundShadow(buf, 19, 29, 13, 3, ctx);

  buf.layer((sub) => {
    // Dark winter pine foliage
    drawLeafCluster(sub, 12 + sway, 22, 6.5, 5, RAMPS.pine, 1);
    drawLeafCluster(sub, 26 + sway, 22, 6.5, 5, RAMPS.pine, 2);
    drawLeafCluster(sub, 19 + sway, 17, 8, 6, RAMPS.pine, 3);

    // Thick frosted snow caps settled on upper crowns
    sub.fillEllipse(13 + sway, 18, 5, 2.2, (nx, ny) =>
      ny < 0 ? '#FFFFFF' : RAMPS.marble.mid
    );
    sub.fillEllipse(25 + sway, 19, 4.5, 2, (nx, ny) =>
      ny < 0 ? RAMPS.marble.highlight : RAMPS.ice.mid
    );
    sub.fillEllipse(19 + sway, 13, 6.5, 2.6, (nx, ny) =>
      ny < -0.1 ? '#FFFFFF' : nx > 0.35 ? RAMPS.ice.mid : RAMPS.marble.highlight
    );

    // Icicles & scarlet winter berries
    sub.drawLine(14 + sway, 20, 14 + sway, 23, RAMPS.ice.highlight, 1);
    sub.drawLine(23 + sway, 15, 23 + sway, 18, RAMPS.ice.highlight, 1);
    for (const [bx, by] of [
      [11 + sway, 23],
      [18 + sway, 20],
      [25 + sway, 22],
    ]) {
      sub.fillRect(bx, by, 2, 2, RAMPS.lava.shadow);
      sub.setPixel(bx, by, '#FF5C6C');
    }
  });

  // Shimmering frost glints
  if (frame % 4 < 2) {
    buf.setPixel(17 + sway, 11, '#FFFFFF');
    buf.setPixel(27 + sway, 18, RAMPS.ice.highlight);
  }

  return buf;
}

function renderFungalCluster(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(40, 36);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const bob = Math.round(Math.sin(t) * 0.7);
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  applyOptionalGroundShadow(buf, 20, 31, 14, 3, ctx);

  // Mossy log & stone bed
  buf.layer((sub) => {
    sub.fillEllipse(20, 29, 13, 3.2, (nx, ny) =>
      ny < -0.2 ? RAMPS.moss.mid : nx > 0.3 ? RAMPS.timber.deep : RAMPS.moss.deep
    );

    // Left medium cyan-emerald glowing mushroom
    sub.fillRect(10, 21, 3, 7, RAMPS.birch.mid);
    sub.setPixel(10, 23, RAMPS.birch.highlight);
    sub.fillEllipse(11, 20, 5, 3, (nx, ny) =>
      ny < -0.2 ? RAMPS.cyanMask.highlight : nx > 0.35 ? RAMPS.copper.deep : RAMPS.cyanMask.mid
    );
    sub.setPixel(9, 19, '#FFFFFF');
    sub.setPixel(13, 19, RAMPS.gold.highlight);

    // Right small autumn amber mushroom
    sub.fillRect(28, 23, 2, 5, RAMPS.bone.mid);
    sub.fillEllipse(29, 22, 4, 2.5, (nx, ny) =>
      ny < -0.2 ? RAMPS.autumn.highlight : RAMPS.autumn.mid
    );
    sub.setPixel(28, 21, '#FFFFFF');

    // Center tall giant K1/amethyst boss mushroom
    sub.fillRect(18, 17 + bob, 4, 12 - bob, RAMPS.birch.mid);
    sub.fillRect(18, 17 + bob, 1, 11 - bob, RAMPS.birch.highlight);
    sub.fillRect(21, 17 + bob, 1, 11 - bob, RAMPS.birch.shadow);
    // Gill skirt under cap
    sub.fillEllipse(20, 17 + bob, 7.5, 2, RAMPS.bone.shadow);
    // Spotted domed cap (K1_MASK)
    sub.fillEllipse(20, 14 + bob, 9, 5, (nx, ny) => {
      if (ny > 0.45 || nx > 0.45) return RAMPS.magenta.deep;
      if (ny < -0.25 && nx < 0.25) return RAMPS.magenta.highlight;
      return RAMPS.magenta.mid;
    });
    // Glowing pale spots on cap
    for (const [sx, sy] of [
      [15, 13 + bob],
      [20, 11 + bob],
      [24, 14 + bob],
    ]) {
      sub.fillRect(sx, sy, 2, 2, pulse > 0.5 ? '#FFFFFF' : RAMPS.bone.highlight);
    }
  });

  // Drifting glowing fungal spores
  for (let i = 0; i < 5; i++) {
    const p = ((frame + i * 2) % total) / total;
    const sx = 10 + i * 5 + Math.round(Math.cos(t + i) * 1.5);
    const sy = Math.round(16 - p * 12);
    buf.setPixel(sx, sy, i % 2 === 0 ? RAMPS.cyanMask.highlight : RAMPS.gold.highlight);
  }

  return buf;
}

/* ============================================================================
 * 7..14: DIVERSE TREE SPECIES (ДЕРЕВЬЯ)
 * ============================================================================ */

function renderAncientOak(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(54, 58);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 1.1);
  const topSway = Math.round(Math.sin(t + 0.6) * 1.3);

  applyOptionalGroundShadow(buf, 27, 52, 19, 4.2, ctx);

  // Flared oak roots, mossy trunk & hollow
  buf.layer((sub) => {
    sub.fillEllipse(27, 51, 12, 2.5, RAMPS.moss.deep);
    drawGnarledTrunk(sub, 27, 25, 51, 4.5, 5, (p) => Math.sin(p * 3) * 0.8, RAMPS.timber);
    // Supporting forked limbs
    sub.drawLine(25, 29, 17 + sway, 21, RAMPS.timber.highlight, 3);
    sub.drawLine(29, 29, 37 + sway, 21, RAMPS.timber.shadow, 3);
    // Moss tufts on roots & hollow knot
    sub.fillEllipse(27, 39, 2, 2.5, VOID);
    sub.setPixel(26, 39, RAMPS.timber.deep);
    sub.fillRect(19, 49, 4, 2, RAMPS.moss.mid);
    sub.fillRect(32, 48, 3, 2, RAMPS.moss.shadow);
  });

  // 7-lobe volumetric oak crown
  buf.layer((sub) => {
    drawLeafCluster(sub, 14 + sway, 25, 8.5, 6.5, RAMPS.pine, 1);
    drawLeafCluster(sub, 40 + sway, 25, 8.5, 6.5, RAMPS.pine, 2);
    drawLeafCluster(sub, 20 + sway, 17, 9.5, 7, RAMPS.moss, 3);
    drawLeafCluster(sub, 34 + sway, 17, 9.5, 7, RAMPS.moss, 4);
    drawLeafCluster(sub, 27 + topSway, 12, 11, 7.5, RAMPS.moss, 5);
    drawLeafCluster(sub, 18 + sway, 22, 7.5, 5.5, RAMPS.moss, 6);
    drawLeafCluster(sub, 35 + sway, 22, 7.5, 5.5, RAMPS.moss, 7);

    // Golden acorns & sun-dappled canopy highlights
    for (const [ax, ay] of [
      [15 + sway, 26],
      [28 + topSway, 18],
      [37 + sway, 25],
    ]) {
      sub.setPixel(ax, ay, RAMPS.gold.highlight);
      sub.setPixel(ax, ay + 1, RAMPS.timber.mid);
    }
  });

  // Single drifting oak leaf falling lazily
  const lp = frame / total;
  const lx = Math.round(19 + Math.sin(t * 2) * 3);
  const ly = Math.round(31 + lp * 17);
  buf.fillRect(lx, ly, 2, 1, RAMPS.moss.highlight);

  return buf;
}

function renderNordicPine(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 58);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const tipSway = Math.round(Math.sin(t) * 1.1);

  applyOptionalGroundShadow(buf, 24, 52, 16, 3.8, ctx);

  // Straight dark trunk & snow drift base
  buf.layer((sub) => {
    sub.fillEllipse(24, 51, 13, 2.8, (nx, ny) =>
      ny < -0.1 ? '#FFFFFF' : RAMPS.ice.mid
    );
    drawGnarledTrunk(sub, 24, 34, 51, 2.5, 2.5, () => 0, RAMPS.timber);
  });

  // 5 cascading jagged pine bough tiers with snow caps
  buf.layer((sub) => {
    const tiers = [
      { topY: 33, h: 11, hw: 16, s: Math.round(tipSway * 0.2) },
      { topY: 25, h: 10, hw: 14, s: Math.round(tipSway * 0.4) },
      { topY: 18, h: 9, hw: 11, s: Math.round(tipSway * 0.6) },
      { topY: 11, h: 9, hw: 8, s: Math.round(tipSway * 0.8) },
      { topY: 5, h: 8, hw: 5, s: tipSway },
    ];
    for (const tier of tiers) {
      for (let dy = 0; dy < tier.h; dy++) {
        const p = dy / (tier.h - 1);
        const span = Math.round(1 + p * tier.hw);
        const py = tier.topY + dy;
        for (let dx = -span; dx <= span; dx++) {
          const px = 24 + tier.s + dx;
          const jag = dy >= tier.h - 2 && Math.abs(dx) % 3 === 0;
          if (jag && dy === tier.h - 1) continue;
          const isSnowCap = dy < Math.max(2, Math.round(tier.h * 0.35)) && Math.abs(dx) <= span - 1;
          if (isSnowCap && dx < span * 0.55) {
            sub.setPixel(px, py, dx < 0 ? '#FFFFFF' : RAMPS.marble.highlight);
          } else if (dx > span * 0.32) {
            sub.setPixel(px, py, RAMPS.pine.deep);
          } else if (dx < -span * 0.35) {
            sub.setPixel(px, py, RAMPS.pine.highlight);
          } else {
            sub.setPixel(px, py, (px + py) % 4 === 0 ? RAMPS.pine.shadow : RAMPS.pine.mid);
          }
        }
      }
    }
    // Hanging pinecones
    sub.fillRect(15, 42, 2, 2, RAMPS.timber.mid);
    sub.fillRect(31, 34, 2, 2, RAMPS.timber.shadow);
  });

  // Drifting snowflakes
  for (let i = 0; i < 5; i++) {
    const p = ((frame + i * 2) % total) / total;
    const sx = 9 + i * 7 + Math.round(Math.sin(t + i) * 2);
    const sy = Math.round(8 + p * 40);
    buf.setPixel(sx, sy, i % 2 === 0 ? '#FFFFFF' : RAMPS.ice.highlight);
  }

  return buf;
}

function renderSakuraTree(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(54, 56);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 1.1);
  const topSway = Math.round(Math.sin(t + 0.8) * 1.2);

  applyOptionalGroundShadow(buf, 27, 50, 18, 4, ctx);

  // Mossy rocks + gracefully sweeping curved trunk
  buf.layer((sub) => {
    sub.fillEllipse(27, 49, 11, 2.5, RAMPS.moss.mid);
    sub.fillEllipse(34, 48, 3.5, 2, RAMPS.slate.mid);
    drawGnarledTrunk(
      sub,
      27,
      23,
      49,
      3.4,
      4,
      (p) => Math.sin(p * Math.PI) * -3.5,
      RAMPS.obsidian
    );
    // Sweeping boughs
    sub.drawLine(25, 27, 14 + sway, 19, RAMPS.obsidian.highlight, 2);
    sub.drawLine(27, 25, 39 + sway, 18, RAMPS.obsidian.mid, 2);
  });

  // Layered cloud-like blossom canopy (sakura ramp + white highlights)
  buf.layer((sub) => {
    drawLeafCluster(sub, 14 + sway, 22, 8.5, 5.5, RAMPS.sakura, 1);
    drawLeafCluster(sub, 40 + sway, 21, 8.5, 5.5, RAMPS.sakura, 2);
    drawLeafCluster(sub, 22 + sway, 15, 9.5, 6.5, RAMPS.sakura, 3);
    drawLeafCluster(sub, 34 + sway, 15, 9, 6, RAMPS.sakura, 4);
    drawLeafCluster(sub, 27 + topSway, 11, 10.5, 6.5, RAMPS.sakura, 5);

    // Delicate white petal glints
    for (const [px, py] of [
      [13 + sway, 19],
      [21 + sway, 11],
      [28 + topSway, 9],
      [35 + sway, 13],
      [41 + sway, 19],
    ]) {
      sub.setPixel(px, py, '#FFFFFF');
      sub.setPixel(px + 1, py + 1, RAMPS.sakura.highlight);
    }
  });

  // Swirling falling cherry petals
  for (let i = 0; i < 6; i++) {
    const p = ((frame + i * 2) % total) / total;
    const px = Math.round(11 + i * 6 + Math.sin(t + i * 1.4) * 3.5);
    const py = Math.round(24 + p * 24);
    buf.setPixel(px, py, i % 2 === 0 ? '#FFFFFF' : RAMPS.sakura.highlight);
  }

  return buf;
}

function renderWeepingWillow(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(56, 58);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 1.0);

  applyOptionalGroundShadow(buf, 28, 52, 20, 4.2, ctx);

  // Wide mossy trunk visible beneath parted curtain vines
  buf.layer((sub) => {
    sub.fillEllipse(28, 51, 13, 2.5, RAMPS.moss.deep);
    drawGnarledTrunk(sub, 28, 22, 51, 4.5, 4.5, (p) => Math.cos(p * 2.5) * 1, RAMPS.timber);
  });

  // Rounded willow crown + 14 wavy hanging leaf curtains
  buf.layer((sub) => {
    drawLeafCluster(sub, 17 + sway, 18, 9, 6, RAMPS.moss, 1);
    drawLeafCluster(sub, 39 + sway, 18, 9, 6, RAMPS.moss, 2);
    drawLeafCluster(sub, 28 + sway, 12, 12, 7, RAMPS.moss, 3);

    const strands = [
      { x: 10, top: 19, len: 26 },
      { x: 13, top: 17, len: 29 },
      { x: 16, top: 16, len: 31 },
      { x: 19, top: 15, len: 30 },
      { x: 22, top: 18, len: 23 },
      { x: 34, top: 18, len: 24 },
      { x: 37, top: 16, len: 31 },
      { x: 40, top: 16, len: 30 },
      { x: 43, top: 17, len: 28 },
      { x: 46, top: 19, len: 25 },
    ];
    for (const s of strands) {
      for (let dy = 0; dy < s.len; dy++) {
        const p = dy / s.len;
        const waveX = Math.round(Math.sin(t - p * 3.2 + s.x * 0.25) * (0.7 + p * 1.6));
        const px = s.x + waveX;
        const py = s.top + dy;
        const c =
          s.x < 24 && dy % 3 === 0
            ? RAMPS.moss.highlight
            : s.x > 36 || p > 0.78
              ? RAMPS.pine.shadow
              : RAMPS.moss.mid;
        sub.setPixel(px, py, c);
        if (dy < s.len * 0.65) {
          sub.setPixel(px + 1, py, s.x > 34 ? RAMPS.moss.deep : RAMPS.moss.shadow);
        }
      }
    }
  });

  return buf;
}

function renderAutumnMaple(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(54, 58);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 1.1);
  const topSway = Math.round(Math.sin(t + 0.7) * 1.3);

  applyOptionalGroundShadow(buf, 27, 52, 18, 4, ctx);

  // Silver-birch pale bark with dark horizontal lenticels
  buf.layer((sub) => {
    sub.fillEllipse(27, 51, 13, 2.5, RAMPS.autumn.shadow);
    drawGnarledTrunk(sub, 27, 25, 51, 3.2, 3.5, (p) => Math.sin(p * 2) * 1.1, RAMPS.birch);
    for (let y = 30; y <= 47; y += 4) {
      sub.fillRect(25, y, 3, 1, RAMPS.obsidian.mid);
    }
  });

  // Fiery multi-ramp autumn canopy (crimson + amber + gold)
  buf.layer((sub) => {
    drawLeafCluster(sub, 14 + sway, 24, 8, 6, RAMPS.lava, 1);
    drawLeafCluster(sub, 40 + sway, 24, 8, 6, RAMPS.autumn, 2);
    drawLeafCluster(sub, 20 + sway, 17, 9, 6.5, RAMPS.autumn, 3);
    drawLeafCluster(sub, 34 + sway, 17, 9, 6.5, RAMPS.lava, 4);
    drawLeafCluster(sub, 27 + topSway, 11, 10.5, 7, RAMPS.gold, 5);
    drawLeafCluster(sub, 27 + sway, 20, 7.5, 5, RAMPS.autumn, 6);
  });

  // Falling crimson & gold maple leaves
  for (let i = 0; i < 5; i++) {
    const p = ((frame + i * 2) % total) / total;
    const lx = Math.round(12 + i * 7 + Math.sin(t + i * 1.9) * 3);
    const ly = Math.round(27 + p * 23);
    buf.setPixel(lx, ly, i % 2 === 0 ? RAMPS.gold.highlight : RAMPS.lava.mid);
  }

  return buf;
}

function renderOasisPalm(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 58);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.sin(t) * 1.8;

  applyOptionalGroundShadow(buf, 25, 52, 16, 3.8, ctx);

  // Curved segmented desert palm trunk + coconuts
  buf.layer((sub) => {
    sub.fillEllipse(25, 51, 11, 2.8, (nx, ny) =>
      ny < -0.15 ? RAMPS.sandstone.highlight : RAMPS.sandstone.mid
    );
    const crownX = 24 + Math.round(sway * 0.6);
    const crownY = 17;
    for (let y = crownY; y <= 50; y++) {
      const p = (y - crownY) / (50 - crownY);
      const curveX = Math.round(25 - Math.sin(p * Math.PI) * 3 + (1 - p) * sway * 0.6);
      const hw = y > 45 ? 3 : 2;
      const ring = y % 4 === 0;
      for (let dx = -hw; dx <= hw; dx++) {
        sub.setPixel(
          curveX + dx,
          y,
          ring
            ? RAMPS.timber.deep
            : dx < 0
              ? RAMPS.sandstone.highlight
              : dx > 1
                ? RAMPS.timber.shadow
                : RAMPS.timber.mid
        );
      }
    }
    // Cluster of coconuts at neck
    sub.fillEllipse(crownX - 2, crownY + 1, 2, 2, RAMPS.timber.shadow);
    sub.fillEllipse(crownX + 2, crownY + 1, 2, 2, RAMPS.timber.deep);
    sub.fillEllipse(crownX, crownY + 2, 2, 2, RAMPS.timber.mid);

    // 6 arching feathered palm fronds waving in breeze
    const fronds = [
      { angle: -2.6, len: 16 },
      { angle: -1.9, len: 14 },
      { angle: -0.9, len: 15 },
      { angle: -0.2, len: 17 },
      { angle: 0.45, len: 15 },
      { angle: 2.8, len: 14 },
    ];
    for (let idx = 0; idx < fronds.length; idx++) {
      const f = fronds[idx];
      const flex = Math.sin(t + idx * 0.5) * 0.14;
      for (let r = 1; r <= f.len; r++) {
        const u = r / f.len;
        const ang = f.angle + u * 0.55 + flex * u;
        const fx = Math.round(crownX + Math.cos(ang) * r);
        const fy = Math.round(crownY + Math.sin(ang) * r * 0.75 + u * u * 5);
        sub.setPixel(fx, fy, u < 0.4 ? RAMPS.moss.highlight : RAMPS.moss.mid);
        // Hanging leaflets under spine
        const leafLen = Math.round((1 - Math.abs(u - 0.55)) * 3.5);
        for (let l = 1; l <= leafLen; l++) {
          sub.setPixel(
            fx,
            fy + l,
            l === leafLen ? RAMPS.pine.deep : u < 0.5 ? RAMPS.moss.mid : RAMPS.moss.shadow
          );
        }
      }
    }
  });

  return buf;
}

function renderBlightedDeadwood(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(52, 58);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const lanternSway = Math.round(Math.sin(t) * 1.4);
  const flicker = (Math.sin(t * 2) + 1) * 0.5;

  applyOptionalGroundShadow(buf, 26, 52, 17, 4, ctx);

  // Bleached bone-bark deadwood tree with clawing bare branches
  buf.layer((sub) => {
    sub.fillEllipse(26, 51, 12, 2.5, RAMPS.slate.deep);
    drawGnarledTrunk(sub, 26, 21, 51, 3.8, 5.5, (p) => Math.sin(p * 4) * 1.8, RAMPS.bone);
    // Scary gnarled dead branches
    sub.drawRibArch(24, 24, 15, 16, 9, 9, 2, RAMPS.bone);
    sub.drawRibArch(16, 17, 11, 19, 8, 15, 1, RAMPS.bone);
    sub.drawRibArch(28, 22, 37, 14, 43, 8, 2, RAMPS.bone);
    sub.drawRibArch(35, 17, 41, 19, 45, 22, 1, RAMPS.bone);
    sub.drawLine(25, 22, 23, 8, RAMPS.bone.highlight, 2);
    sub.drawLine(23, 8, 20, 4, RAMPS.bone.mid, 1);

    // Haunted skull-hollow glowing eye sockets inside trunk
    sub.fillEllipse(26, 36, 2.5, 3, VOID);
    sub.setPixel(25, 35, RAMPS.magenta.highlight);
    sub.setPixel(27, 35, RAMPS.magenta.highlight);
  });

  // Hanging swinging lantern from right bough
  drawSwingingLantern(buf, 41, 22, lanternSway, flicker);

  // Rising ghostly K1 wisps
  for (let i = 0; i < 4; i++) {
    const p = ((frame + i * 3) % total) / total;
    const wx = Math.round(13 + i * 8 + Math.sin(t + i) * 2);
    const wy = Math.round(18 - p * 12);
    buf.setPixel(wx, wy, i % 2 === 0 ? RAMPS.magenta.highlight : RAMPS.cyanMask.highlight);
  }

  return buf;
}

function renderBambooGrove(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 56);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.sin(t) * 1.3;

  applyOptionalGroundShadow(buf, 24, 51, 15, 3.4, ctx);

  buf.layer((sub) => {
    sub.fillEllipse(24, 50, 12, 2.5, RAMPS.moss.deep);
    sub.fillEllipse(15, 49, 3, 2, RAMPS.slate.mid);

    const stalks = [
      { x: 14, topY: 16, w: 2, ramp: RAMPS.pine, phase: 0.2 },
      { x: 19, topY: 8, w: 3, ramp: RAMPS.moss, phase: 0.7 },
      { x: 24, topY: 13, w: 2, ramp: RAMPS.emerald, phase: 1.2 },
      { x: 29, topY: 7, w: 3, ramp: RAMPS.moss, phase: 1.8 },
      { x: 34, topY: 18, w: 2, ramp: RAMPS.pine, phase: 2.3 },
    ];
    for (const s of stalks) {
      const h = 49 - s.topY;
      for (let y = s.topY; y <= 49; y++) {
        const p = 1 - (y - s.topY) / h;
        const dx = Math.round(p * (sway + Math.sin(t + s.phase) * 0.5));
        const isNode = (y - s.topY) % 6 === 0;
        for (let k = 0; k < s.w; k++) {
          sub.setPixel(
            s.x + dx + k,
            y,
            isNode ? RAMPS.pine.deep : k === 0 ? s.ramp.highlight : k === s.w - 1 ? s.ramp.shadow : s.ramp.mid
          );
        }
        // Fluttering narrow bamboo leaf sprays near nodes
        if (isNode && y < 34) {
          const dir = (s.x + y) % 2 === 0 ? 1 : -1;
          const tipX = s.x + dx + dir * 5 + Math.round(sway * 0.5);
          sub.drawLine(s.x + dx, y, tipX, y - 2, s.ramp.highlight, 1);
          sub.drawLine(s.x + dx, y + 1, tipX - dir, y + 2, s.ramp.mid, 1);
        }
      }
    }
  });

  return buf;
}

export const NATURE_MODELS: PixelModelDef[] = [
  {
    id: 'berry-bush',
    name: 'Пышный Ягодный Куст',
    subtitle: '5-дольный кустарник с ягодами (36×32)',
    kind: 'nature',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 36,
    height: 32,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Древесные побеги у основания',
      '1. 5 объёмных ярусов листвы moss/pine',
      '2. Гроздья алых ягод с белыми бликами и колыхание на ветру',
    ],
    description:
      'Базовый лесной куст: многодольная крона с глубокими пазухами тени, ветвями у земли, спелыми ягодами и плавным бризом.',
    renderFrame: renderBerryBush,
    codeSnippet: `function renderBerryBush(frame: number, total: number): PixelBuffer { /* 5-lobe bush + wind sway */ return new PixelBuffer(36, 32); }`,
  },
  {
    id: 'thorn-briar',
    name: 'Колючий Терновник',
    subtitle: 'Переплетённые шипастые лозы (38×34)',
    kind: 'nature',
    tier: 'I',
    faction: 'Некрополь',
    width: 38,
    height: 34,
    frameCount: 12,
    defaultFps: 8,
    layersSpec: [
      '0. Тёмный хвойный подлесок',
      '1. Дуги переплетённых колючих стеблей drawRibArch',
      '2. Острые шипы и мерцающие бутоны паслёна',
    ],
    description:
      'Агрессивный кустарник для тёмных биомов: переплетённые колючие ветви с костяными шипами и аметистовыми бутонами.',
    renderFrame: renderThornBriar,
    codeSnippet: `function renderThornBriar(frame: number, total: number): PixelBuffer { /* thorny arches & buds */ return new PixelBuffer(38, 34); }`,
  },
  {
    id: 'mana-shrub',
    name: 'Магический Куст Маны',
    subtitle: 'Светящийся кустарник со спорами (38×36)',
    kind: 'nature',
    tier: 'II',
    faction: 'Цитадель',
    width: 38,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    layersSpec: [
      '0. Серебристые корни birch и пышная листва emerald/copper',
      '1. Цветки лотоса маны на масках K1/K2',
      '2. Восходящие огоньки светящейся пыльцы',
    ],
    description:
      'Фэнтезийный куст маны: перекрашиваемые под державу бутоны K1/K2, серебристые стебли и восходящие частицы пыльцы.',
    renderFrame: renderManaShrub,
    codeSnippet: `function renderManaShrub(frame: number, total: number): PixelBuffer { /* K1/K2 blossoms + pollen */ return new PixelBuffer(38, 36); }`,
  },
  {
    id: 'desert-scrub',
    name: 'Опунция и Пустынный Куст',
    subtitle: 'Кактусовые побеги и перекати-поле (38×34)',
    kind: 'nature',
    tier: 'I',
    faction: 'Орда',
    width: 38,
    height: 34,
    frameCount: 12,
    defaultFps: 8,
    layersSpec: [
      '0. Песчаный барханный холмик sandstone',
      '1. Сегментированные лепёшки кактуса-опунции с иголками',
      '2. Яркие пустынные цветки и сухая полынь',
    ],
    description:
      'Пустынный ксерофитный куст: сочные овальные сегменты опунции, острые иголки, оранжевые цветки и сухие ветки на ветру.',
    renderFrame: renderDesertScrub,
    codeSnippet: `function renderDesertScrub(frame: number, total: number): PixelBuffer { /* cactus pads + desert blooms */ return new PixelBuffer(38, 34); }`,
  },
  {
    id: 'frost-holly',
    name: 'Морозный Падуб',
    subtitle: 'Заснеженный куст с сосульками (38×34)',
    kind: 'nature',
    tier: 'I',
    faction: 'Бастион Мороза',
    width: 38,
    height: 34,
    frameCount: 12,
    defaultFps: 8,
    noOutlineRequired: true,
    layersSpec: [
      '0. Тёмная вечнозелёная хвоя pine',
      '1. Объёмные шапки снега и ледяные сосульки',
      '2. Алые зимние ягоды и морозный блеск',
    ],
    description:
      'Зимний колючий кустарник под сугробом снега с голубыми сосульками, яркими ягодами и мерцанием инея.',
    renderFrame: renderFrostHolly,
    codeSnippet: `function renderFrostHolly(frame: number, total: number): PixelBuffer { /* snowdrifts + icicles */ return new PixelBuffer(38, 34); }`,
  },
  {
    id: 'fungal-cluster',
    name: 'Мицелиевая Поросль',
    subtitle: 'Светящиеся грибные кусты K1/K2 (40×36)',
    kind: 'nature',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 40,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    layersSpec: [
      '0. Мшистая лесная подушка',
      '1. Три разновысотных гриба со шляпками K1/K2 и пластинками',
      '2. Парящие вверх светящиеся споры',
    ],
    description:
      'Подземный и лесной грибной куст: шляпки в масках K1/K2 с пульсирующими пятнами и роем восходящих спор.',
    renderFrame: renderFungalCluster,
    codeSnippet: `function renderFungalCluster(frame: number, total: number): PixelBuffer { /* giant mushrooms + spores */ return new PixelBuffer(40, 36); }`,
  },
  {
    id: 'ancient-oak',
    name: 'Вековой Дуб',
    subtitle: 'Раскидистое дерево с дуплом (54×58)',
    kind: 'nature',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 54,
    height: 58,
    frameCount: 12,
    defaultFps: 8,
    noOutlineRequired: true,
    layersSpec: [
      '0. Узловатый ствол с раскидистыми корнями и дуплом',
      '1. 7-дольная густая крона с фактурой листьев и желудями',
      '2. Падающий осенне-зелёный лист и колебание кроны',
    ],
    description:
      'Классический вековой дуб: мощная корневая система, мшистый ствол, глубокая многоярусная крона и покачивание под ветром.',
    renderFrame: renderAncientOak,
    codeSnippet: `function renderAncientOak(frame: number, total: number): PixelBuffer { /* gnarled oak + 7-lobe canopy */ return new PixelBuffer(54, 58); }`,
  },
  {
    id: 'nordic-pine',
    name: 'Заснеженная Северная Ель',
    subtitle: '5-ярусная хвоя под снегом (48×58)',
    kind: 'nature',
    tier: 'I',
    faction: 'Бастион Мороза',
    width: 48,
    height: 58,
    frameCount: 12,
    defaultFps: 9,
    noOutlineRequired: true,
    layersSpec: [
      '0. Сугроб и прямой смолистый ствол',
      '1. 5 каскадных ярусов рваных еловых лап',
      '2. Снежные шапки, шишки и падающие снежинки',
    ],
    description:
      'Северное хвойное дерево: пять ярусов иглистых ветвей, плотно укрытых снегом, с колыханием верхушки и снегопадом.',
    renderFrame: renderNordicPine,
    codeSnippet: `function renderNordicPine(frame: number, total: number): PixelBuffer { /* 5 conifer tiers + snowfall */ return new PixelBuffer(48, 58); }`,
  },
  {
    id: 'sakura-tree',
    name: 'Цветущая Сакура',
    subtitle: 'Вишня с кружащими лепестками (54×56)',
    kind: 'nature',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 54,
    height: 56,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    layersSpec: [
      '0. Изогнутый тёмный ствол и мшистый камень у корней',
      '1. Воздушная розовая крона sakura с белыми соцветиями',
      '2. Кружащийся поток падающих лепестков',
    ],
    description:
      'Декоративное цветущее дерево: пластичный S-образный ствол, пышная нежно-розовая крона и живой листопад лепестков.',
    renderFrame: renderSakuraTree,
    codeSnippet: `function renderSakuraTree(frame: number, total: number): PixelBuffer { /* curved trunk + falling petals */ return new PixelBuffer(54, 56); }`,
  },
  {
    id: 'weeping-willow',
    name: 'Плакучая Ива',
    subtitle: 'Волнообразные ниспадающие плети (56×58)',
    kind: 'nature',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 56,
    height: 58,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Широкий мшистый ствол',
      '1. Куполообразная верхняя крона',
      '2. 10 длинных гибких плетей-занавесов, колышущихся волной',
    ],
    description:
      'Прибрежная плакучая ива: сквозь завесу длинных волнистых ветвей проглядывает ствол, создавая эффект мягкого ветра.',
    renderFrame: renderWeepingWillow,
    codeSnippet: `function renderWeepingWillow(frame: number, total: number): PixelBuffer { /* waving willow curtains */ return new PixelBuffer(56, 58); }`,
  },
  {
    id: 'autumn-maple',
    name: 'Осенний Багряный Клён',
    subtitle: 'Янтарно-алый листопад (54×58)',
    kind: 'nature',
    tier: 'II',
    faction: 'Гильдия',
    width: 54,
    height: 58,
    frameCount: 12,
    defaultFps: 9,
    noOutlineRequired: true,
    layersSpec: [
      '0. Светлый ствол с тёмными чечевичками коры',
      '1. Трёхцветная крона: багрец, янтарь и золото',
      '2. Закрученные падающие кленовые листья',
    ],
    description:
      'Осеннее лиственное дерево: контрастный светлый ствол и пылающая палитра кроны с опадающей листвой.',
    renderFrame: renderAutumnMaple,
    codeSnippet: `function renderAutumnMaple(frame: number, total: number): PixelBuffer { /* tri-tone autumn crown */ return new PixelBuffer(54, 58); }`,
  },
  {
    id: 'oasis-palm',
    name: 'Финиковая Пальма Оазиса',
    subtitle: 'Сегментированный ствол и 6 вееров (50×58)',
    kind: 'nature',
    tier: 'I',
    faction: 'Кузня Пекла',
    width: 50,
    height: 58,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Песчаный пригорок и кольчатый изогнутый ствол',
      '1. Гроздь кокосов под кроной',
      '2. 6 изогнутых перистых листьев с волной от бриза',
    ],
    description:
      'Тропическая пальма: кольцевые сегменты коры, гроздья кокосов и упругие раскидистые листья под морским ветром.',
    renderFrame: renderOasisPalm,
    codeSnippet: `function renderOasisPalm(frame: number, total: number): PixelBuffer { /* curved ringed trunk + fronds */ return new PixelBuffer(50, 58); }`,
  },
  {
    id: 'blighted-deadwood',
    name: 'Проклятое Дерево Некрополя',
    subtitle: 'Сухие сучья и качающийся фонарь (52×58)',
    kind: 'nature',
    tier: 'II',
    faction: 'Некрополь',
    width: 52,
    height: 58,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    layersSpec: [
      '0. Выбеленный искривлённый ствол с дуплом-черепом',
      '1. Когтистые оголённые сучья без листвы',
      '2. Раскачивающийся фонарь и призрачные искры',
    ],
    description:
      'Зловещее сухое дерево пустошей: выбеленная кора, светящееся дупло, качающийся фонарь на цепи и блуждающие огоньки.',
    renderFrame: renderBlightedDeadwood,
    codeSnippet: `function renderBlightedDeadwood(frame: number, total: number): PixelBuffer { /* bleached claws + lantern */ return new PixelBuffer(52, 58); }`,
  },
  {
    id: 'bamboo-grove',
    name: 'Бамбуковая Роща',
    subtitle: '5 узловатых стеблей с листвой (48×56)',
    kind: 'nature',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 48,
    height: 56,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Мшистый валун у корней',
      '1. 5 разновысоких сегментированных стеблей с колечками',
      '2. Узкие трепещущие пучки бамбуковых листьев',
    ],
    description:
      'Восточная рощица бамбука: чёткие междоузлия разной толщины и плавное независимое покачивание тонких стеблей.',
    renderFrame: renderBambooGrove,
    codeSnippet: `function renderBambooGrove(frame: number, total: number): PixelBuffer { /* segmented bamboo stalks */ return new PixelBuffer(48, 56); }`,
  },
];
