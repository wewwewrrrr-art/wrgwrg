import { drawClockworkGear } from '../engine/architectureGrammar';
import { MaterialRamp, RAMPS, VOID } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef, RenderContextOptions } from './types';

/**
 * ============================================================================
 * STRUCTURAL SUBSTANCES & MATERIAL MONOLITHS (10 HIGH-CRAFT MODELS)
 * ============================================================================
 * Focuses on distinct physical substances and surface shaders:
 * crystal prism refraction, conchoidal obsidian glass, glacial ice depth,
 * porous basalt + molten magma, weathered sandstone + moss, copper verdigris,
 * quartz-gold ore veins, translucent fossil amber, iridescent bismuth, coral.
 * ============================================================================
 */

function applyShadow(
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
 * Helper: Draws a jagged, faceted pixel-art stone massif or outcrop boulder
 * using deterministic angular noise instead of smooth rounded ellipses.
 */
function paintJaggedBoulder(
  sub: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  ramp: Pick<MaterialRamp, 'deep' | 'shadow' | 'mid' | 'highlight'>,
  veinColor?: string
): void {
  const minX = Math.floor(cx - rx - 2);
  const maxX = Math.ceil(cx + rx + 2);
  const minY = Math.floor(cy - ry - 2);
  const maxY = Math.ceil(cy + ry + 2);

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const nx = (px - cx) / Math.max(1, rx);
      const ny = (py - cy) / Math.max(1, ry);
      const ang = Math.atan2(ny, nx);
      // Angular craggy facet modulation (octagonal stone planes)
      const facet =
        0.13 * Math.cos(ang * 3 + seed) +
        0.09 * Math.sin(ang * 5 - seed * 1.7);
      const r = Math.hypot(nx, ny) * (1 + facet);
      if (r > 1.0) continue;

      const stratum = ((px * 3 + py * 5 + seed) & 7) === 0;
      const diagCrease = Math.abs(px - py + (seed % 5)) % 9 === 0;
      let col: string;
      if (veinColor && diagCrease && r < 0.72) {
        col = veinColor;
      } else if (ny < -0.32 && nx < 0.22) {
        col = ramp.highlight;
      } else if (nx > 0.34 || ny > 0.42 || r > 0.86) {
        col = ramp.deep;
      } else if (stratum || ny > 0.14) {
        col = ramp.shadow;
      } else {
        col = ramp.mid;
      }
      sub.setPixel(px, py, col);
    }
  }
}

/**
 * Helper: Draws a faceted crystal prism column with sharp diagonal light plane,
 * specular ridge, and stepped apex.
 */
function drawFacetedPrism(
  sub: PixelBuffer,
  cx: number,
  baseY: number,
  halfW: number,
  height: number,
  tilt: number,
  ramp: Pick<MaterialRamp, 'deep' | 'shadow' | 'mid' | 'highlight'>,
  glint = false
): void {
  for (let i = 0; i < height; i++) {
    const py = baseY - i;
    const p = i / Math.max(1, height - 1);
    const centerX = cx + Math.round(p * tilt);
    const taper = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;
    const hw = Math.max(0, Math.round(halfW * taper));
    for (let dx = -hw; dx <= hw; dx++) {
      const px = centerX + dx;
      const isSpine = dx === -Math.max(0, Math.floor(hw * 0.25));
      const c =
        p > 0.88 && glint
          ? '#FFFFFF'
          : isSpine || dx < -hw * 0.45
            ? ramp.highlight
            : dx > hw * 0.35
              ? ramp.deep
              : dx > 0
                ? ramp.shadow
                : ramp.mid;
      sub.setPixel(px, py, c);
    }
  }
}

/**
 * 1. Amethyst & Quartz Crystal Geode (48x48, Tier II, 12f)
 */
function renderCrystalGeode(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const phase = Math.floor((frame / total) * 4);

  applyShadow(buf, 24, 42, 17, 4, ctx);

  // Outer cracked basalt rock bowl
  buf.layer((sub) => {
    sub.fillEllipse(24, 34, 15, 9, (nx, ny, px, py) => {
      const grain = (px * 5 + py * 3) % 7 === 0;
      if (nx < -0.3 && ny < 0.2) return RAMPS.slate.highlight;
      if (nx > 0.35 || ny > 0.45) return RAMPS.slate.deep;
      return grain ? RAMPS.slate.shadow : RAMPS.slate.mid;
    });
    // Hollow dark interior cavity
    sub.fillEllipse(24, 31, 11, 5.5, VOID);
    sub.fillEllipse(24, 32, 9.5, 4, RAMPS.amethyst.deep);
  });

  // 7 faceted crystals erupting out of the geode cavity
  buf.layer((sub) => {
    drawFacetedPrism(sub, 16, 33, 3, 14, -4, RAMPS.amethyst, phase === 0);
    drawFacetedPrism(sub, 32, 33, 3, 13, 4, RAMPS.amethyst, phase === 2);
    drawFacetedPrism(sub, 20, 32, 3.5, 19, -2, RAMPS.magenta, phase === 1);
    drawFacetedPrism(sub, 28, 32, 3.5, 17, 2, RAMPS.amethyst, phase === 3);
    drawFacetedPrism(sub, 24, 34, 4.5, 24, 0, RAMPS.magenta, phase === 0 || phase === 2);
    drawFacetedPrism(sub, 19, 36, 2, 8, -1, RAMPS.cyanMask, phase === 1);
    drawFacetedPrism(sub, 29, 36, 2, 8, 1, RAMPS.cyanMask, phase === 3);
  });

  // Rotating sparkle glints on facets
  const spX = 24 + Math.round(Math.cos(t) * 9);
  const spY = 17 + Math.round(Math.sin(t) * 6);
  buf.setPixel(spX, spY, '#FFFFFF');
  buf.setPixel(24 - Math.round(Math.cos(t) * 7), 22, RAMPS.cyanMask.highlight);

  return buf;
}

/**
 * 2. Obsidian Runic Monolith (46x56, Tier III, 12f)
 */
function renderObsidianMonolith(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(46, 56);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const hover = Math.round(Math.sin(t) * 1.5);
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  applyShadow(buf, 23, 50, 15, 3.8, ctx);

  // Shattered volcanic slate pedestal
  buf.layer((sub) => {
    sub.fillEllipse(23, 48, 13, 4, (nx, ny) =>
      ny < -0.2 ? RAMPS.slate.highlight : nx > 0.3 ? RAMPS.obsidian.deep : RAMPS.slate.mid
    );
    sub.fillEllipse(23, 46, 10, 2.5, RAMPS.obsidian.mid);
  });

  // Razor-sharp tapering obsidian obelisk with glossy conchoidal streaks
  buf.layer((sub) => {
    const topY = 10 + hover;
    const botY = 44 + hover;
    for (let y = topY; y <= botY; y++) {
      const p = (y - topY) / (botY - topY);
      const hw = y < topY + 6 ? Math.max(1, y - topY) : Math.round(6 + (1 - p) * 2.2);
      for (let dx = -hw; dx <= hw; dx++) {
        const isGlassy = dx === -2 || (dx === -1 && (y + dx) % 5 === 0);
        const isFracture = (dx * 3 - y) % 9 === 0 && dx < 2;
        const c = isGlassy
          ? RAMPS.amethyst.highlight
          : isFracture
            ? RAMPS.obsidian.highlight
            : dx < 0
              ? RAMPS.obsidian.mid
              : dx > 3
                ? RAMPS.obsidian.deep
                : RAMPS.obsidian.shadow;
        sub.setPixel(23 + dx, y, c);
      }
    }
    // Glowing carved K2 runes down center spine
    for (const ry of [21 + hover, 27 + hover, 33 + hover]) {
      const glow = pulse > 0.5 ? '#FFFFFF' : RAMPS.cyanMask.highlight;
      sub.fillRect(22, ry, 2, 3, RAMPS.cyanMask.mid);
      sub.setPixel(22, ry + 1, glow);
    }
  });

  // Orbiting levitating obsidian splinters
  buf.layer((sub) => {
    const ox = Math.round(Math.cos(t) * 12);
    const oy = Math.round(Math.sin(t) * 3);
    drawFacetedPrism(sub, 23 + ox, 28 + oy, 1.5, 6, 0, RAMPS.obsidian, true);
    drawFacetedPrism(sub, 23 - ox, 24 - oy, 1.5, 5, 0, RAMPS.amethyst, false);
  });

  return buf;
}

/**
 * 3. Glacier Ice Spire (50x52, Tier II, 12f)
 */
function renderGlacierIceSpire(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 52);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  applyShadow(buf, 25, 46, 17, 4, ctx);

  // Permafrost stone plinth
  buf.layer((sub) => {
    sub.fillEllipse(25, 44, 15, 4.2, (nx, ny) =>
      ny < -0.15 ? RAMPS.marble.highlight : nx > 0.3 ? RAMPS.ice.deep : RAMPS.ice.mid
    );
  });

  // Multi-shard translucent glacial ice massif
  buf.layer((sub) => {
    drawFacetedPrism(sub, 15, 44, 4, 21, -3, RAMPS.ice, frame % 6 === 0);
    drawFacetedPrism(sub, 35, 44, 4, 19, 3, RAMPS.ice, frame % 6 === 3);
    drawFacetedPrism(sub, 25, 45, 7, 34, -1, RAMPS.ice, true);

    // Internal frozen air bubbles & vertical fracture lines
    for (let y = 18; y <= 40; y += 5) {
      sub.setPixel(23, y, '#FFFFFF');
      sub.drawLine(25, y, 27, y + 3, RAMPS.ice.deep, 1);
    }
    // Snow cap crest on left shoulder
    sub.fillEllipse(15, 27, 3.5, 1.5, '#FFFFFF');
    sub.fillEllipse(24, 13, 2.5, 1.5, '#FFFFFF');
  });

  // Shimmering frost mist particles
  for (let i = 0; i < 4; i++) {
    const p = ((frame + i * 3) % total) / total;
    const fx = Math.round(13 + i * 8 + Math.sin(t + i) * 2);
    const fy = Math.round(42 - p * 16);
    buf.setPixel(fx, fy, '#FFFFFFAA');
  }

  return buf;
}

/**
 * 4. Molten Basalt Magma Vent — Terraced Volcano Cone (50x48, Tier II, 12f)
 * Terraced volcanic basalt cone: craggy grey ledges + flowing magma streams + smoke puffs.
 */
function renderMoltenBasaltVent(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  applyShadow(buf, 25, 42, 18, 4.2, ctx);

  // Terraced grey volcanic basalt cone with glowing caldera & lava tongues
  buf.layer((sub) => {
    for (let y = 19; y <= 41; y++) {
      const p = (y - 19) / 22;
      const stepJag = Math.round(Math.sin(y * 1.1) * 1.2);
      const hw = Math.round(7 + p * 10.5) + stepJag;
      for (let dx = -hw; dx <= hw; dx++) {
        const px = 25 + dx;
        const ridgeLine = y === 26 || y === 34;
        const leftStream = y > 22 && Math.abs(dx + 1 - Math.round(Math.sin(y * 0.42) * 2.2)) <= (y < 32 ? 1 : 0);
        const rightStream = y > 25 && Math.abs(dx - 4 - Math.round(Math.cos(y * 0.5) * 1.4)) === 0;
        if (leftStream || rightStream) {
          sub.setPixel(px, y, pulse > 0.45 && y < 32 ? '#FFE678' : y < 33 ? RAMPS.lava.highlight : RAMPS.lava.mid);
        } else if (ridgeLine && Math.abs(dx) < hw - 1) {
          sub.setPixel(px, y, dx < 0 ? RAMPS.slate.highlight : RAMPS.obsidian.deep);
        } else if (dx < -hw * 0.35) {
          sub.setPixel(px, y, RAMPS.slate.mid);
        } else if (dx > hw * 0.35) {
          sub.setPixel(px, y, RAMPS.obsidian.deep);
        } else {
          sub.setPixel(px, y, RAMPS.obsidian.mid);
        }
      }
    }

    // Molten caldera rim & boiling golden-orange crown
    sub.fillEllipse(25, 20, 7.5, 2.8, (nx, ny) => {
      const r = Math.hypot(nx, ny);
      if (r < 0.48) return pulse > 0.5 ? '#FFF8B8' : RAMPS.lava.highlight;
      if (r < 0.8) return RAMPS.lava.mid;
      return RAMPS.lava.shadow;
    });
    const bx = 25 + Math.round(Math.sin(t) * 2.5);
    sub.fillRect(bx, 18 - (frame % 3), 2, 2, '#FFF8B8');
  });

  // Rising golden-amber smoke puffs & glowing volcanic sparks (matching image_3d66ed6f.png)
  for (let i = 0; i < 5; i++) {
    const p = ((frame + i * 2) % total) / total;
    const sx = Math.round(18 + ((i * 5) % 14) + Math.sin(t + i * 1.3) * 2.2);
    const sy = Math.round(16 - p * 12);
    if (i < 3) {
      buf.fillEllipse(sx, sy, 2.4 - p * 0.8, 1.8 - p * 0.5, p < 0.5 ? '#FFE66DBB' : '#9498A388');
    } else {
      buf.setPixel(sx, sy, p < 0.4 ? '#FFFFFF' : RAMPS.lava.highlight);
    }
  }

  return buf;
}

/**
 * 5. Mossy Sandstone Ruin Dolmen (52x48, Tier I, 1f static)
 */
function renderMossyDolmen(_frame: number, _total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(52, 48);

  applyShadow(buf, 26, 42, 18, 4.2, ctx);

  // Mossy turf + standing weathered limestone pillars
  buf.layer((sub) => {
    sub.fillEllipse(26, 40, 16, 4, (nx, ny) =>
      ny < -0.2 ? RAMPS.moss.mid : RAMPS.moss.deep
    );
    // Left pillar
    sub.fillRect(13, 21, 7, 19, RAMPS.birch.mid);
    sub.fillRect(13, 21, 2, 19, RAMPS.birch.highlight);
    sub.fillRect(18, 21, 2, 19, RAMPS.birch.shadow);
    // Right pillar
    sub.fillRect(32, 22, 7, 18, RAMPS.birch.shadow);
    sub.fillRect(32, 22, 2, 18, RAMPS.birch.mid);
    sub.fillRect(37, 22, 2, 18, RAMPS.birch.deep);
    // Eroded horizontal strata & cracks
    for (const cy of [26, 32, 36]) {
      sub.drawLine(14, cy, 18, cy, RAMPS.birch.deep, 1);
      sub.drawLine(33, cy + 1, 37, cy + 1, RAMPS.birch.deep, 1);
    }
    // Carved spiral rune in stone
    sub.fillRect(15, 28, 3, 3, RAMPS.cyanMask.mid);
    sub.setPixel(16, 29, RAMPS.cyanMask.highlight);
  });

  // Heavy weathered capstone lintel + lush moss blanket + forest ferns
  buf.layer((sub) => {
    sub.fillEllipse(26, 17, 16, 5, (nx, ny, px, py) => {
      const stratum = py % 3 === 0;
      if (ny < -0.35 && nx < 0.25) return RAMPS.birch.highlight;
      if (nx > 0.38 || ny > 0.45) return RAMPS.birch.deep;
      return stratum ? RAMPS.birch.shadow : RAMPS.birch.mid;
    });
    // Moss cushions on top of lintel & hanging vines
    sub.fillEllipse(20, 14, 7, 2.5, (nx, ny) =>
      ny < 0 ? RAMPS.moss.highlight : RAMPS.moss.mid
    );
    sub.fillEllipse(32, 15, 5, 2, RAMPS.moss.mid);
    sub.drawLine(25, 18, 25, 24, RAMPS.moss.mid, 1);
    sub.drawLine(29, 19, 29, 23, RAMPS.moss.shadow, 1);
    // Fern fronds under arch
    sub.drawLine(26, 39, 22, 34, RAMPS.moss.highlight, 1);
    sub.drawLine(26, 39, 30, 34, RAMPS.moss.mid, 1);
  });

  return buf;
}

/**
 * 6. Brass & Verdigris Copper Steam Boiler (50x54, Tier II, 12f)
 */
function renderBrassSteamBoiler(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 54);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const piston = Math.round(Math.sin(t * 2) * 1.5);

  applyShadow(buf, 25, 48, 17, 4, ctx);

  // Iron grate plinth
  buf.layer((sub) => {
    sub.fillEllipse(25, 46, 15, 4, (nx, ny) =>
      ny < -0.2 ? RAMPS.slate.highlight : RAMPS.slate.deep
    );
  });

  // Riveted oxidized copper drum + brass bands + glass sight gauge
  buf.layer((sub) => {
    for (let y = 19; y <= 44; y++) {
      const isBrassBand = y === 22 || y === 33 || y === 42;
      for (let dx = -10; dx <= 10; dx++) {
        const nx = dx / 10;
        const ramp = isBrassBand ? RAMPS.gold : RAMPS.copper;
        const c = nx < -0.35 ? ramp.highlight : nx > 0.4 ? ramp.deep : nx > 0.15 ? ramp.shadow : ramp.mid;
        sub.setPixel(25 + dx, y, c);
      }
      if (y === 22 || y === 33) {
        for (let rx = 17; rx <= 33; rx += 4) sub.setPixel(rx, y, '#FFFFFF');
      }
    }
    // Domed copper boiler cap & chimney pipe
    sub.fillEllipse(25, 19, 10, 4.5, (nx, ny) =>
      ny < -0.25 && nx < 0.25 ? RAMPS.gold.highlight : nx > 0.35 ? RAMPS.gold.deep : RAMPS.gold.mid
    );
    sub.fillRect(23, 9, 4, 8, RAMPS.copper.mid);
    sub.fillRect(23, 9, 1, 8, RAMPS.copper.highlight);
    sub.fillRect(22, 8, 6, 2, RAMPS.gold.highlight);

    // Glass sight-tube showing boiling K2 liquid level + furnace grate
    sub.fillRect(19, 25, 3, 7, VOID);
    sub.fillRect(20, 27 + piston, 1, 4 - piston, RAMPS.cyanMask.highlight);
    sub.fillRect(25, 36, 6, 5, VOID);
    sub.fillRect(26, 38, 4, 3, piston > 0 ? RAMPS.lava.highlight : RAMPS.lava.mid);
  });

  // Spinning brass pressure valve wheel on side
  drawClockworkGear(buf, 36, 28, 4, 6, t, RAMPS.gold, RAMPS.lava.highlight);

  // Rising translucent white steam puffs from chimney
  for (let i = 0; i < 4; i++) {
    const p = ((frame + i * 3) % total) / total;
    const sx = Math.round(25 + Math.sin(t + i) * 2.5 + p * 3);
    const sy = Math.round(7 - p * 6);
    buf.fillEllipse(sx, sy, 2 + p, 1.5, '#E6F0FAAA');
  }

  return buf;
}

/**
 * 7. Gold-Quartz Ore Vein — Large + Small Cluster (48x46, Tier I, 12f)
 */
function renderGoldQuartzVein(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 46);
  const seamPos = (frame / Math.max(1, total)) * 20;
  const activeNugget = frame % 5;
  const glintCross = frame % 3;

  applyShadow(buf, 24, 40, 18, 4, ctx);

  // Main faceted granite boulder + secondary small ore outcrop at base-right
  buf.layer((sub) => {
    paintJaggedBoulder(sub, 20, 28, 12.5, 10.5, 7, RAMPS.slate);
    paintJaggedBoulder(sub, 16, 19, 6.2, 5.2, 3, RAMPS.slate);
    paintJaggedBoulder(sub, 37, 34, 5.2, 4.2, 11, RAMPS.slate);

    // Milky white quartz diagonal veins
    sub.drawLine(11, 23, 29, 33, RAMPS.birch.highlight, 2);
    sub.drawLine(19, 16, 25, 35, RAMPS.marble.highlight, 2);

    // Traveling quartz specular highlight wave
    const qx = Math.round(11 + seamPos);
    const qy = Math.round(23 + (seamPos / 20) * 10);
    sub.fillRect(qx, qy, 2, 1, '#FFFFFF');

    // Gleaming raw gold nuggets embedded across both large and small deposits
    const nuggets = [
      { x: 14, y: 23, r: 2.3 },
      { x: 21, y: 26, r: 3.1 },
      { x: 27, y: 30, r: 2.4 },
      { x: 20, y: 18, r: 2.1 },
      { x: 37, y: 33, r: 2.0 },
    ];
    nuggets.forEach((n, idx) => {
      const isLit = activeNugget === idx;
      sub.fillEllipse(n.x, n.y, n.r, n.r * 0.85, (nx, ny) => {
        if (nx < -0.2 || ny < -0.2) return isLit ? '#FFF4B8' : RAMPS.gold.highlight;
        if (nx > 0.3) return RAMPS.gold.deep;
        return RAMPS.gold.mid;
      });
      if (isLit) {
        sub.setPixel(n.x - 1, n.y - 1, '#FFFFFF');
        sub.setPixel(n.x, n.y - 2, '#FFFFFF');
        if (glintCross === 0) sub.setPixel(n.x + 1, n.y - 1, '#FFFFFF');
        if (glintCross === 1) sub.setPixel(n.x - 2, n.y - 1, '#FFFFFF');
      }
    });
  });

  return buf;
}

/**
 * 8. Amber Resin Fossil Pillar (46x50, Tier II, 12f)
 */
function renderAmberFossilPillar(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(46, 50);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const gleamY = 14 + Math.round(((Math.sin(t) + 1) * 0.5) * 18);

  applyShadow(buf, 23, 44, 15, 3.8, ctx);

  // Earthy sandstone & moss cradle
  buf.layer((sub) => {
    sub.fillEllipse(23, 42, 13, 3.8, (nx, ny) =>
      ny < -0.2 ? RAMPS.sandstone.highlight : RAMPS.sandstone.mid
    );
    sub.fillRect(12, 40, 4, 2, RAMPS.moss.mid);
  });

  // Translucent warm honey-amber prism with suspended dark beetle fossil
  buf.layer((sub) => {
    for (let y = 11; y <= 40; y++) {
      const p = (y - 11) / 29;
      const hw = y < 17 ? Math.round(1 + ((y - 11) / 5) * 6) : Math.round(7 + Math.sin(p * Math.PI) * 1.5);
      for (let dx = -hw; dx <= hw; dx++) {
        const px = 23 + dx;
        const distCenter = Math.hypot(dx / 5, (y - 26) / 7);
        const c =
          dx < -hw * 0.45
            ? RAMPS.gold.highlight
            : distCenter < 0.7
              ? RAMPS.autumn.highlight
              : dx > hw * 0.4
                ? RAMPS.autumn.shadow
                : RAMPS.autumn.mid;
        sub.setPixel(px, y, c);
      }
    }
    // Suspended ancient dark fossil insect inside core
    sub.fillEllipse(23, 26, 2.5, 3.5, RAMPS.timber.deep);
    sub.drawLine(20, 24, 18, 22, VOID, 1);
    sub.drawLine(26, 24, 28, 22, VOID, 1);
    sub.drawLine(20, 27, 18, 28, VOID, 1);
    sub.drawLine(26, 27, 28, 28, VOID, 1);

    // Vertical glossy resin highlight + traveling refraction gleam
    sub.drawLine(18, 17, 18, 36, '#FFFFFF', 1);
    sub.setPixel(19, gleamY, '#FFFFFF');
    sub.setPixel(20, gleamY + 1, RAMPS.gold.highlight);
    sub.setPixel(26, 38 - (frame % 12), RAMPS.gold.highlight);
  });

  return buf;
}

/**
 * 9. Iridescent Bismuth Hopper Crystal (48x48, Tier III, 12f)
 */
function renderBismuthCrystal(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 48);
  const shift = frame % total;

  applyShadow(buf, 24, 42, 16, 3.8, ctx);

  const iridescentPalette = [
    RAMPS.gold.highlight,
    RAMPS.copper.highlight,
    RAMPS.cyanMask.highlight,
    RAMPS.magenta.highlight,
    RAMPS.amethyst.highlight,
    RAMPS.emerald.highlight,
  ];

  // Concentric stepped hopper geometry characteristic of bismuth crystals
  buf.layer((sub) => {
    // Base metallic plinth cluster
    sub.fillRect(10, 26, 28, 15, RAMPS.slate.deep);
    for (let step = 0; step < 5; step++) {
      const size = 26 - step * 4;
      const x0 = 24 - Math.floor(size / 2);
      const y0 = 13 + step * 2;
      const c = iridescentPalette[(step + shift) % iridescentPalette.length];
      const dark = step % 2 === 0 ? RAMPS.obsidian.shadow : RAMPS.slate.deep;
      // Top & left bright metallic hopper rim
      sub.fillRect(x0, y0, size, 2, c);
      sub.fillRect(x0, y0, 2, size, c);
      // Right & bottom shaded recess inside hopper step
      sub.fillRect(x0 + size - 2, y0 + 2, 2, size - 2, dark);
      sub.fillRect(x0 + 2, y0 + size - 2, size - 2, 2, dark);
    }
    // Secondary angled side hopper cube
    sub.fillRect(30, 24, 9, 9, RAMPS.cyanMask.mid);
    sub.fillRect(32, 26, 5, 5, VOID);
    sub.fillRect(33, 27, 3, 3, iridescentPalette[(shift + 2) % iridescentPalette.length]);
    // Traveling corner specular sparkle
    const sparkIdx = frame % 5;
    sub.setPixel(11 + sparkIdx * 2, 13 + sparkIdx * 2, '#FFFFFF');
    sub.setPixel(12 + sparkIdx * 2, 13 + sparkIdx * 2, '#FFFFFF');
  });

  return buf;
}

/**
 * 10. Marine Coral Reef Colony (50x48, Tier I, 12f)
 */
function renderCoralReef(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 0.9);

  applyShadow(buf, 25, 43, 17, 3.8, ctx);

  // Limestone sea-floor rock + porous brain coral + staghorn branches
  buf.layer((sub) => {
    sub.fillEllipse(25, 38, 16, 5, (nx, ny) =>
      ny < -0.2 ? RAMPS.birch.highlight : nx > 0.35 ? RAMPS.birch.deep : RAMPS.birch.mid
    );
    // Teal brain coral dome
    sub.fillEllipse(32, 34, 6, 4.5, (nx, ny, px, py) => {
      const maze = (px + py) % 3 === 0;
      if (ny < -0.25 && nx < 0.2) return RAMPS.copper.highlight;
      return maze ? RAMPS.copper.deep : RAMPS.copper.mid;
    });
    // Golden tube sponges on left
    for (const [tx, h] of [
      [14, 11],
      [17, 14],
    ]) {
      sub.fillRect(tx, 37 - h, 3, h, RAMPS.gold.mid);
      sub.fillRect(tx, 37 - h, 1, h, RAMPS.gold.highlight);
      sub.fillRect(tx, 37 - h, 3, 1, VOID);
    }
    // Branching pink-coral antlers (sakura + K1)
    sub.drawLine(24, 36, 22 + sway, 19, RAMPS.sakura.mid, 3);
    sub.drawLine(23 + sway, 26, 16 + sway, 17, RAMPS.sakura.highlight, 2);
    sub.drawLine(23 + sway, 24, 29 + sway, 14, RAMPS.sakura.mid, 2);
    sub.drawLine(28 + sway, 20, 34 + sway, 16, RAMPS.sakura.shadow, 2);
  });

  // Rising underwater air bubbles
  for (let i = 0; i < 5; i++) {
    const p = ((frame + i * 2) % total) / total;
    const bx = Math.round(14 + i * 6 + Math.sin(t + i) * 1.5);
    const by = Math.round(33 - p * 23);
    buf.setPixel(bx, by, i % 2 === 0 ? '#FFFFFF' : RAMPS.ice.highlight);
  }

  return buf;
}

/**
 * 11. Stone Ore Deposit — Large & Small Boulders (48x44, Tier I, 1f)
 */
function renderOreStoneDeposit(_frame: number, _total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 44);
  applyShadow(buf, 24, 38, 17, 4, ctx);

  // Main faceted granite/stone massif
  buf.layer((sub) => {
    paintJaggedBoulder(sub, 20, 27, 11.5, 8.8, 1, RAMPS.slate);
    paintJaggedBoulder(sub, 18, 20, 6.2, 4.2, 5, {
      deep: RAMPS.slate.shadow,
      shadow: RAMPS.slate.mid,
      mid: RAMPS.slate.highlight,
      highlight: RAMPS.marble.mid,
    });
    sub.drawLine(14, 27, 25, 31, RAMPS.slate.deep, 1);
  });

  // Small & medium companion stone boulders
  buf.layer((sub) => {
    paintJaggedBoulder(sub, 35, 31, 6.0, 4.6, 9, RAMPS.slate);
    paintJaggedBoulder(sub, 11, 34, 4.0, 3.0, 14, RAMPS.slate);
  });

  return buf;
}

/**
 * 12. Iron Ore Deposit — Large & Small Rust-Veined Lode (48x46, Tier I, 12f)
 */
function renderOreIronDeposit(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 46);
  const sweep = frame / Math.max(1, total);
  applyShadow(buf, 24, 40, 17, 4, ctx);

  buf.layer((sub) => {
    paintJaggedBoulder(sub, 21, 28, 12, 9.2, 4, {
      deep: RAMPS.obsidian.deep,
      shadow: RAMPS.slate.deep,
      mid: RAMPS.slate.shadow,
      highlight: RAMPS.slate.mid,
    }, RAMPS.copper.shadow);
    paintJaggedBoulder(sub, 18, 20, 6.2, 4.8, 8, RAMPS.slate);
    paintJaggedBoulder(sub, 36, 33, 5.4, 4.0, 12, RAMPS.slate, RAMPS.copper.shadow);

    // Metallic wrought-iron seams + warm rust halos + sweeping steel glint
    const veins = [
      { x1: 13, y1: 25, x2: 24, y2: 20 },
      { x1: 16, y1: 31, x2: 28, y2: 26 },
      { x1: 33, y1: 33, x2: 38, y2: 31 },
    ];
    veins.forEach((v) => {
      sub.drawLine(v.x1, v.y1 + 1, v.x2, v.y2 + 1, RAMPS.timber.mid, 2);
      sub.drawLine(v.x1, v.y1, v.x2, v.y2, RAMPS.marble.mid, 2);
    });
    const activeVein = veins[frame < 5 ? 0 : frame < 10 ? 1 : 2];
    const localP = frame < 5 ? frame / 4 : frame < 10 ? (frame - 5) / 4 : (frame - 10) / 1;
    const gx = Math.round(activeVein.x1 + (activeVein.x2 - activeVein.x1) * localP);
    const gy = Math.round(activeVein.y1 + (activeVein.y2 - activeVein.y1) * localP);
    sub.fillRect(gx, gy, 2, 1, '#FFFFFF');
    if (sweep > 0.5) sub.setPixel(gx, gy - 1, RAMPS.ice.highlight);
  });

  return buf;
}

/**
 * 13. Silver Ore Deposit — Polished Native Silver Veins (48x46, Tier I, 12f)
 */
function renderOreSilverDeposit(frame: number, _total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 46);
  const pulse = frame % 6;
  applyShadow(buf, 24, 40, 17, 4, ctx);

  buf.layer((sub) => {
    paintJaggedBoulder(sub, 21, 28, 12, 9.2, 6, RAMPS.slate);
    paintJaggedBoulder(sub, 25, 20, 5.8, 4.5, 10, RAMPS.slate);
    paintJaggedBoulder(sub, 36, 33, 5.4, 4.1, 15, RAMPS.slate);

    // Wide gleaming native silver ribbons across faces
    sub.drawLine(13, 27, 25, 19, RAMPS.marble.highlight, 3);
    sub.drawLine(17, 32, 29, 25, '#FFFFFF', 2);
    sub.drawLine(34, 34, 38, 31, RAMPS.marble.highlight, 2);

    const glintPts: [number, number][] = [
      [19, 23],
      [23, 20],
      [22, 29],
      [27, 26],
      [36, 32],
      [15, 26],
    ];
    const [gx, gy] = glintPts[pulse % glintPts.length];
    sub.setPixel(gx, gy, '#FFFFFF');
    sub.setPixel(gx + 1, gy, RAMPS.ice.highlight);
    if (frame % 3 === 0) sub.setPixel(gx, gy - 1, '#FFFFFF');
  });

  return buf;
}

/**
 * 14. Mythril Ore Deposit — Jagged Slate with Mint-Teal Crystal Spires (48x48, Tier II, 12f)
 */
function renderOreMythrilDeposit(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const spark = Math.floor((frame / Math.max(1, total)) * 4);
  applyShadow(buf, 24, 42, 17, 4, ctx);

  const mythrilRamp = {
    deep: '#1D6B5E',
    shadow: '#2BA38D',
    mid: '#5BE0C1',
    highlight: '#C2FFF0',
  };

  buf.layer((sub) => {
    paintJaggedBoulder(sub, 21, 32, 12.2, 7.2, 2, RAMPS.slate);
    paintJaggedBoulder(sub, 37, 35, 4.8, 3.5, 9, RAMPS.slate);
  });

  buf.layer((sub) => {
    drawFacetedPrism(sub, 15, 32, 3, 14, -3, mythrilRamp, spark === 0);
    drawFacetedPrism(sub, 22, 33, 4, 21, -1, mythrilRamp, spark === 1);
    drawFacetedPrism(sub, 28, 33, 3, 16, 2, mythrilRamp, spark === 2);
    drawFacetedPrism(sub, 37, 35, 2, 10, 1, mythrilRamp, spark === 3);
    const sx = Math.round(22 + Math.cos(t) * 10);
    const sy = Math.round(24 + Math.sin(t) * 6);
    sub.setPixel(sx, sy, '#FFFFFF');
  });

  return buf;
}

/**
 * 15. Adamantine Ore Deposit — Curved Cobalt-Blue Spires (50x48, Tier III, 12f)
 */
function renderOreAdamantineDeposit(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const spark = frame % 6;
  applyShadow(buf, 25, 42, 18, 4, ctx);

  const adamantineRamp = {
    deep: '#0E3166',
    shadow: '#1B5AA8',
    mid: '#2E93EB',
    highlight: '#9EE8FF',
  };

  buf.layer((sub) => {
    paintJaggedBoulder(sub, 22, 34, 12.8, 6.4, 5, {
      deep: RAMPS.obsidian.deep,
      shadow: RAMPS.obsidian.mid,
      mid: RAMPS.slate.shadow,
      highlight: RAMPS.slate.mid,
    });
    paintJaggedBoulder(sub, 38, 36, 5.0, 3.4, 13, RAMPS.slate);
  });

  buf.layer((sub) => {
    drawFacetedPrism(sub, 15, 34, 3.2, 16, -2, adamantineRamp, spark === 0);
    drawFacetedPrism(sub, 22, 35, 4.5, 25, -3, adamantineRamp, spark === 2);
    drawFacetedPrism(sub, 29, 34, 3.5, 19, 2, adamantineRamp, spark === 4);
    drawFacetedPrism(sub, 38, 36, 2.2, 12, -1, adamantineRamp, spark === 5);

    const gx = Math.round(24 + Math.cos(t) * 9);
    const gy = Math.round(25 + Math.sin(t) * 6);
    sub.setPixel(gx, gy, '#FFFFFF');
  });

  return buf;
}

/**
 * 16. Crimson Ruby & Volcanic Ore Deposit — Large & Small Peaks (48x48, Tier III, 12f)
 */
function renderOreRubyGemDeposit(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const pulse = (Math.sin(t * 2) + 1) * 0.5;
  applyShadow(buf, 24, 42, 17, 4, ctx);

  buf.layer((sub) => {
    // Tall pointed obsidian-charcoal main peak
    for (let i = 0; i < 25; i++) {
      const py = 37 - i;
      const p = i / 24;
      const hw = Math.max(1, Math.round((1 - p * 0.88) * 10));
      for (let dx = -hw; dx <= hw; dx++) {
        const px = 21 + dx;
        const c =
          dx < -hw * 0.35
            ? RAMPS.slate.mid
            : dx > hw * 0.35
              ? RAMPS.obsidian.deep
              : RAMPS.obsidian.mid;
        sub.setPixel(px, py, c);
      }
    }
    // Companion smaller conical shard on the right
    for (let i = 0; i < 14; i++) {
      const py = 38 - i;
      const p = i / 13;
      const hw = Math.max(1, Math.round((1 - p * 0.85) * 5.5));
      for (let dx = -hw; dx <= hw; dx++) {
        sub.setPixel(36 + dx, py, dx < 0 ? RAMPS.slate.shadow : RAMPS.obsidian.deep);
      }
    }

    // Embedded glowing crimson ruby & ember ore veins
    const gems: [number, number, boolean][] = [
      [18, 22, true],
      [22, 26, false],
      [17, 31, false],
      [25, 32, true],
      [20, 17, true],
      [35, 32, false],
      [37, 35, true],
    ];
    gems.forEach(([gx, gy, hot], idx) => {
      const lit = (frame + idx) % 4 === 0;
      sub.fillRect(gx, gy, 2, 2, hot ? RAMPS.lava.mid : '#C9243B');
      sub.setPixel(
        gx,
        gy,
        lit ? '#FFF4B8' : hot ? RAMPS.lava.highlight : '#FF5C6C'
      );
    });
    if (pulse > 0.6) {
      sub.setPixel(20, 17, '#FFFFFF');
    }
  });

  return buf;
}

/**
 * 17. Acid Geyser Mound — Terraced Basalt Crater, Toxic Spill Pools & Mist (50x48, Tier II, 12f)
 * Multi-tiered plum-basalt volcanic crater with caustic steam vents.
 */
function renderAcidGeyser(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const pulse = (Math.sin(t * 2) + 1) * 0.5;
  applyShadow(buf, 25, 42, 18, 4.2, ctx);

  const geyserBasalt = {
    deep: '#201926',
    shadow: '#312638',
    mid: '#44364E',
    highlight: '#5E4D6B',
  };

  // 1. Irregular terraced dark plum-basalt mound with tiered toxic pools spilling down front
  buf.layer((sub) => {
    paintJaggedBoulder(sub, 25, 34, 15.5, 7.6, 4, geyserBasalt);
    paintJaggedBoulder(sub, 25, 27, 9.5, 5.2, 9, geyserBasalt);
    paintJaggedBoulder(sub, 16, 36, 6.2, 3.6, 13, geyserBasalt);
    paintJaggedBoulder(sub, 34, 36, 5.5, 3.4, 17, geyserBasalt);

    // Top steaming acid cauldron pool (shaded #236B12 lip -> #7AF224 mid -> #DCFF5E glowing boil)
    sub.fillEllipse(25, 24, 6.5, 2.8, (nx, ny) => {
      const r = Math.hypot(nx, ny);
      if (r < 0.42) return pulse > 0.45 ? '#F0FF9E' : '#C9FF4D';
      if (r < 0.78) return '#7AF224';
      return '#2D7D14';
    });

    // Overflowing terraced acid basins cascading down craggy ledges (exact look from image_3d66ed6f.png)
    sub.fillEllipse(18, 32, 4.6, 2.4, (nx, ny) =>
      Math.hypot(nx, ny) < 0.5 ? '#CFFF4F' : ny > 0.35 ? '#266E12' : '#6BE31E'
    );
    sub.fillEllipse(28, 34, 4.2, 2.3, (nx, ny) =>
      Math.hypot(nx, ny) < 0.48 ? '#B8FF3D' : ny > 0.35 ? '#236911' : '#57D41A'
    );
    sub.fillEllipse(22, 39, 3.2, 1.8, (_, ny) => (ny < 0 ? '#9EFF33' : '#359918'));

    // Bright spillover acid stream rivulets connecting caldera to lower pools
    sub.drawLine(22, 26, 19, 30, '#A8FF3B', 1);
    sub.drawLine(27, 26, 28, 32, '#8EF229', 1);
    sub.drawLine(24, 35, 22, 38, '#7AE823', 1);

    // Popping white-lime boil bubble on caldera surface
    const bx = 25 + Math.round(Math.cos(t) * 2.5);
    const by = 22 - (frame % 3);
    sub.fillRect(bx, by, 2, 2, '#F4FFB3');
  });

  // 2. Floating billowing neon-green toxic mist puffs & acid droplets rising above the geyser
  for (let i = 0; i < 6; i++) {
    const p = ((frame + i * 2) % total) / total;
    const mx = Math.round(16 + ((i * 6) % 18) + Math.sin(t + i * 1.4) * 2.5);
    const my = Math.round(22 - p * 15);
    if (i % 2 === 0) {
      buf.fillEllipse(mx, my, 2.6 - p * 0.8, 1.8 - p * 0.5, p < 0.5 ? '#B8FF5E88' : '#6EE02B55');
    } else {
      buf.setPixel(mx, my, p < 0.45 ? '#ECFF85DD' : '#7EF22EAA');
    }
  }

  return buf;
}

export const SUBSTANCE_MODELS: PixelModelDef[] = [
  {
    id: 'crystal-geode',
    name: 'Аметистовая Друза',
    subtitle: 'Гранёный кварц в базальте (48×48)',
    kind: 'substance',
    tier: 'II',
    faction: 'Цитадель',
    width: 48,
    height: 48,
    frameCount: 12,
    defaultFps: 9,
    noOutlineRequired: true,
    layersSpec: [
      '0. Расколотая базальтовая чаша с тёмной полостью',
      '1. 7 шестигранных призм K1/amethyst/K2 с острыми бликами',
      '2. Перебегающие по граням солнечные искры',
    ],
    description:
      'Минеральная структура кристаллической породы: резкие светотеневые грани, прозрачное преломление и вращающиеся блики.',
    renderFrame: renderCrystalGeode,
    codeSnippet: `function renderCrystalGeode(frame: number, total: number): PixelBuffer { /* 7-prism amethyst geode */ return new PixelBuffer(48, 48); }`,
  },
  {
    id: 'obsidian-monolith',
    name: 'Обсидиановый Монолит',
    subtitle: 'Вулканическое стекло с рунами K2 (46×56)',
    kind: 'substance',
    tier: 'III',
    faction: 'Некрополь',
    width: 46,
    height: 56,
    frameCount: 12,
    defaultFps: 10,
    layersSpec: [
      '0. Раздробленный сланцевый постамент',
      '1. Парящий обелиск с раковистыми сколами вулканического стекла',
      '2. Пульсирующие руны K2 и орбитальные осколки',
    ],
    description:
      'Образец стеклянистой породы: гладкие зеркальные грани обсидиана, резкие сколы, левитирующие обломки и рунический канал K2.',
    renderFrame: renderObsidianMonolith,
    codeSnippet: `function renderObsidianMonolith(frame: number, total: number): PixelBuffer { /* conchoidal obsidian + orbiting shards */ return new PixelBuffer(46, 56); }`,
  },
  {
    id: 'glacier-ice-spire',
    name: 'Ледниковый Торос',
    subtitle: 'Многослойный преломляющий лёд (50×52)',
    kind: 'substance',
    tier: 'II',
    faction: 'Бастион Мороза',
    width: 50,
    height: 52,
    frameCount: 12,
    defaultFps: 8,
    noOutlineRequired: true,
    layersSpec: [
      '0. Мерзлотный ледяной фундамент',
      '1. Гранёные массивы плотного голубого льда',
      '2. Внутренние трещины, пузырьки воздуха и снежные шапки',
    ],
    description:
      'Структура прозрачного льда: холодная голубая глубина, внутренние воздушные включения, трещины преломления и морозный пар.',
    renderFrame: renderGlacierIceSpire,
    codeSnippet: `function renderGlacierIceSpire(frame: number, total: number): PixelBuffer { /* refractive ice massif */ return new PixelBuffer(50, 52); }`,
  },
  {
    id: 'molten-basalt-vent',
    name: 'Магматический Кратер',
    subtitle: 'Пористый базальт и кипящая лава (50×48)',
    kind: 'substance',
    tier: 'II',
    faction: 'Кузня Пекла',
    width: 50,
    height: 48,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    layersSpec: [
      '0. Пористая вулканическая порода с сеткой трещин',
      '1. Пульсирующее озерцо магмы с пузырями',
      '2. Восходящий рой раскалённых углей',
    ],
    description:
      'Контраст пористой чёрной вулканической корки и раскалённой жидкой магмы, прорывающейся сквозь разломы.',
    renderFrame: renderMoltenBasaltVent,
    codeSnippet: `function renderMoltenBasaltVent(frame: number, total: number): PixelBuffer { /* porous basalt + molten fissures */ return new PixelBuffer(50, 48); }`,
  },
  {
    id: 'mossy-dolmen',
    name: 'Древний Мшистый Дольмен',
    subtitle: 'Слоистый известняк и бархатный мох (52×48)',
    kind: 'substance',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 52,
    height: 48,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Монолитные опоры из выветренного известняка birch',
      '1. Горизонтально-слоистая плита перекрытия со сколами',
      '2. Бархатные подушки мха, лианы и папоротники',
    ],
    description:
      'Статичная мегалитическая структура с чёткой слоистой фактурой осадочного камня, трещинами времени и живым мхом.',
    renderFrame: renderMossyDolmen,
    codeSnippet: `function renderMossyDolmen(): PixelBuffer { /* stratified limestone + moss */ return new PixelBuffer(52, 48); }`,
  },
  {
    id: 'brass-steam-boiler',
    name: 'Латунно-Медный Котёл',
    subtitle: 'Патинированная медь, клёпка и пар (50×54)',
    kind: 'substance',
    tier: 'II',
    faction: 'Гильдия',
    width: 50,
    height: 54,
    frameCount: 12,
    defaultFps: 11,
    noOutlineRequired: true,
    layersSpec: [
      '0. Клёпаный цилиндр из патинированной меди copper и латуни gold',
      '1. Стеклянная колба уровня воды K2 и топка с жаром',
      '2. Вращающийся вентиль и клубы белого пара',
    ],
    description:
      'Техно-материальная структура: бирюзовая окисленная патина меди, полированные латунные ободы с заклёпками, стекло и пар.',
    renderFrame: renderBrassSteamBoiler,
    codeSnippet: `function renderBrassSteamBoiler(frame: number, total: number): PixelBuffer { /* verdigris copper + riveted brass */ return new PixelBuffer(50, 54); }`,
  },
  {
    id: 'gold-quartz-vein',
    name: 'Золотоносная Кварцевая Жила',
    subtitle: 'Гранит, белый кварц и самородки (48×46)',
    kind: 'substance',
    tier: 'I',
    faction: 'Гильдия',
    width: 48,
    height: 46,
    frameCount: 12,
    defaultFps: 8,
    layersSpec: [
      '0. Грубый гранитный валун slate с трещинами',
      '1. Молочно-белая диагональная жила кварца',
      '2. Вкрапления золотых самородков с перебегающим блеском',
    ],
    description:
      'Рудная геологическая структура: зернистый серый гранит, рассечённый белым кварцем с мерцающими золотыми жилами.',
    renderFrame: renderGoldQuartzVein,
    codeSnippet: `function renderGoldQuartzVein(frame: number, total: number): PixelBuffer { /* granite + quartz + gold nuggets */ return new PixelBuffer(48, 46); }`,
  },
  {
    id: 'amber-fossil-pillar',
    name: 'Янтарный Монолит с Реликтом',
    subtitle: 'Прозрачная смола с включением (46×50)',
    kind: 'substance',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 46,
    height: 50,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Песчаниковое ложе со мхом',
      '1. Полупрозрачный медовый массив янтаря с внутренним светом',
      '2. Застывший доисторический жук и бегущий блик смолы',
    ],
    description:
      'Тёплое полупрозрачное вещество древней смолы: глубокий медовый градиент, глянцевый вертикальный блик и силуэт реликта внутри.',
    renderFrame: renderAmberFossilPillar,
    codeSnippet: `function renderAmberFossilPillar(frame: number, total: number): PixelBuffer { /* translucent honey amber + inclusion */ return new PixelBuffer(46, 50); }`,
  },
  {
    id: 'bismuth-hopper-crystal',
    name: 'Ступенчатый Кристалл Висмута',
    subtitle: 'Радужная оксидная «лестница» (48×48)',
    kind: 'substance',
    tier: 'III',
    faction: 'Цитадель',
    width: 48,
    height: 48,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Тёмная металлическая основа',
      '1. Концентрические прямоугольные террасы роста кристалла',
      '2. Переливающаяся оксидная плёнка: золото → медь → бирюза → аметист',
    ],
    description:
      'Уникальная кристаллическая решётка висмута: вложенные геометрические ступени с живым радужным переливом тонкой плёнки.',
    renderFrame: renderBismuthCrystal,
    codeSnippet: `function renderBismuthCrystal(frame: number, total: number): PixelBuffer { /* iridescent stepped bismuth hopper */ return new PixelBuffer(48, 48); }`,
  },
  {
    id: 'coral-reef-colony',
    name: 'Морской Коралловый Риф',
    subtitle: 'Известняк, мозговик и ветвистые полипы (50×48)',
    kind: 'substance',
    tier: 'I',
    faction: 'Бастион Мороза',
    width: 50,
    height: 48,
    frameCount: 12,
    defaultFps: 9,
    noOutlineRequired: true,
    layersSpec: [
      '0. Рифовый известняк и пористый коралл-мозговик copper',
      '1. Трубчатые губки и розовый ветвистый коралл sakura',
      '2. Пузырьки воздуха, поднимающиеся к поверхности воды',
    ],
    description:
      'Живая биоминеральная структура рифа: сочетание извилистого коралла-мозговика, жёлтых губок, ветвей полипов и пузырьков.',
    renderFrame: renderCoralReef,
    codeSnippet: `function renderCoralReef(frame: number, total: number): PixelBuffer { /* limestone + brain coral + bubbles */ return new PixelBuffer(50, 48); }`,
  },
  {
    id: 'ore-stone-deposit',
    name: 'Каменная Залежь (Крупная и малая)',
    subtitle: 'Валуны гранита и сколы породы (48×44)',
    kind: 'substance',
    tier: 'I',
    faction: 'Цитадель',
    width: 48,
    height: 44,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Крупный слоистый гранитный валун со сколами и трещинами',
      '1. Малые камни-спутники у основания залежи',
    ],
    description:
      'Базовая залежь строительного камня: сочетание массивной скальной глыбы и малых валунов рядом с мягким затенением.',
    renderFrame: renderOreStoneDeposit,
    codeSnippet: `function renderOreStoneDeposit(): PixelBuffer { /* large & small granite stone boulders */ return new PixelBuffer(48, 44); }`,
  },
  {
    id: 'ore-iron-deposit',
    name: 'Железная Руда (Залежь)',
    subtitle: 'Тёмный сланец с прожилками железа и ржавчины (48×46)',
    kind: 'substance',
    tier: 'I',
    faction: 'Гильдия',
    width: 48,
    height: 46,
    frameCount: 12,
    defaultFps: 8,
    layersSpec: [
      '0. Угловатая железорудная глыба и малый обломок',
      '1. Матовые стальные пласты с бурой кромкой окислов',
      '2. Перебегающий металлический блик по жиле',
    ],
    description:
      'Металлоносная порода: крупная жила и малый обломок рудного железа с характерным контрастом холодной стали и рыжей коррозии.',
    renderFrame: renderOreIronDeposit,
    codeSnippet: `function renderOreIronDeposit(frame: number, total: number): PixelBuffer { /* ironstone boulder + steel/rust seams */ return new PixelBuffer(48, 46); }`,
  },
  {
    id: 'ore-silver-deposit',
    name: 'Серебряная Руда (Залежь)',
    subtitle: 'Графит с широкими пластами серебра (48×46)',
    kind: 'substance',
    tier: 'I',
    faction: 'Цитадель',
    width: 48,
    height: 46,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Полированные диагональные пласты самородного серебра',
      '1. Холодный искристый блик по основной и малой глыбам',
    ],
    description:
      'Благородная серебряная жила с яркими светло-стальными прожилками и малым рудным камнем у основания.',
    renderFrame: renderOreSilverDeposit,
    codeSnippet: `function renderOreSilverDeposit(frame: number, total: number): PixelBuffer { /* graphite + native silver bands */ return new PixelBuffer(48, 46); }`,
  },
  {
    id: 'ore-mythril-deposit',
    name: 'Мифриловая Залежь',
    subtitle: 'Скальные зубцы с кристаллами мифрила (48×48)',
    kind: 'substance',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 48,
    height: 48,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: [
      '0. Тёмный сланцевый массив и малый кристалл-спутник',
      '1. Четыре гранёные мятно-бирюзовые призмы мифрила',
      '2. Искрящийся перелив вершин кристаллов',
    ],
    description:
      'Редкая магическая руда: из тёмной породы пробиваются острые грани светящегося бирюзового мифрила (крупная и малая друза).',
    renderFrame: renderOreMythrilDeposit,
    codeSnippet: `function renderOreMythrilDeposit(frame: number, total: number): PixelBuffer { /* dark slate + glowing mythril prisms */ return new PixelBuffer(48, 48); }`,
  },
  {
    id: 'ore-adamantine-deposit',
    name: 'Адамантиновая Жила',
    subtitle: 'Острые клыки кобальтового металла (50×48)',
    kind: 'substance',
    tier: 'III',
    faction: 'Бастион Мороза',
    width: 50,
    height: 48,
    frameCount: 12,
    defaultFps: 10,
    layersSpec: [
      '0. Тёмно-синий сланцевый цоколь и малый боковой зубец',
      '1. Изогнутые кобальтово-голубые клинки адамантина',
      '2. Холодные зеркальные блики на острых гранях',
    ],
    description:
      'Сверхпрочная руда высшего уровня: загнутые тёмно-синие шипы адамантина с яркой лазурной кромкой и сателлитным сколом.',
    renderFrame: renderOreAdamantineDeposit,
    codeSnippet: `function renderOreAdamantineDeposit(frame: number, total: number): PixelBuffer { /* curved cobalt adamantine spires */ return new PixelBuffer(50, 48); }`,
  },
  {
    id: 'ore-ruby-gem-deposit',
    name: 'Огненно-Рубиновая Руда',
    subtitle: 'Вулканические конусы с самоцветами (48×48)',
    kind: 'substance',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 48,
    height: 48,
    frameCount: 12,
    defaultFps: 10,
    layersSpec: [
      '0. Высокий базальтовый пик и малый конус рядом',
      '1. Вкрапления алых рубинов и тлеющих оранжевых самоцветов',
    ],
    description:
      'Редкая глубинная порода: остроконечные тёмные скалы, испещрённые мерцающими алыми самоцветами и огненными прожилками.',
    renderFrame: renderOreRubyGemDeposit,
    codeSnippet: `function renderOreRubyGemDeposit(frame: number, total: number): PixelBuffer { /* basalt cones + glowing crimson gems */ return new PixelBuffer(48, 48); }`,
  },
  {
    id: 'acid-geyser',
    name: 'Кислотный Гейзер',
    subtitle: 'Пузырящийся токсичный источник (50×48)',
    kind: 'substance',
    tier: 'II',
    faction: 'Некрополь',
    width: 50,
    height: 48,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    layersSpec: [
      '0. Пористый чёрный кратер-холм с кислотными лужами',
      '1. Светящиеся лаймово-зелёные ручьи и лопающиеся пузыри',
      '2. Поднимающиеся капли ядовитых испарений',
    ],
    description:
      'Опасная геотермальная формация: тёмная горка породы с кипящими неоново-зелёными озёрцами кислоты и токсичными пузырями.',
    renderFrame: renderAcidGeyser,
    codeSnippet: `function renderAcidGeyser(frame: number, total: number): PixelBuffer { /* toxic volcanic mound + acid bubbles */ return new PixelBuffer(50, 48); }`,
  },
];
