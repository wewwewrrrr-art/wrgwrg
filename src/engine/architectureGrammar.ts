import { INK, MaterialRamp, RAMPS, SHADOW_COLOR, VOID } from './palette';
import { PixelBuffer } from './pixelCanvas';

/**
 * ============================================================================
 * FORMAL ARCHITECTURAL GRAMMAR FOR 3/4 ORTHOGRAPHIC RTS PIXEL STRUCTURES
 * ============================================================================
 * High-density procedural building blocks (54–64 px grid) for classic
 * isometric/3/4 strategy sprites.
 *
 * RULE 1 (Key Light): Illumination arrives from TOP-LEFT (-1, -1).
 *   - Left edges & upper ridges receive `ramp.highlight`
 *   - Front facades receive `ramp.mid` broken by staggered stone/grain seams
 *   - Right-facing wall returns (4–7 px wide) receive `ramp.shadow` / `ramp.deep`
 *
 * RULE 2 (Ambient Occlusion): Roof eaves, balconies, and tier steps cast a
 *   1–2 px dark shadow strip onto the masonry directly below them.
 *
 * RULE 3 (Layer Isolation): Call these inside `buf.layer(...)` whenever a
 *   sub-assembly overlaps another so crisp internal material seams appear.
 * ============================================================================
 */

/**
 * Stage 0A: Soft cast shadow ellipse underneath a structure's plinth.
 */
export function drawCastGroundShadow(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  const shadowBuf = new PixelBuffer(buf.width, buf.height);
  shadowBuf.fillEllipse(cx, cy, rx, ry, SHADOW_COLOR);
  buf.compositeUnder(shadowBuf);
}

/**
 * Stage 0B: Ground Plinth / Stepped Foundation Pad with shaded bevel rim,
 * cobblestone texture, and optional corner moss or ember accents.
 */
export function drawGroundPlinth(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  topRamp: MaterialRamp = RAMPS.sandstone,
  rimRamp: MaterialRamp = RAMPS.timber,
  _withShadow = false
): void {
  buf.layer((sub) => {
    // 3px vertical plinth rim
    sub.fillEllipse(cx, cy + 2, rx, ry, (nx, ny) =>
      ny > 0.25 || nx > 0.4 ? rimRamp.deep : nx > 0.1 ? rimRamp.shadow : rimRamp.mid
    );
    // Top paved / earth plane with subtle cobble pattern
    sub.fillEllipse(cx, cy, rx - 1, ry - 0.5, (nx, ny, px, py) => {
      const cobble = (px * 3 + py * 5) % 11 === 0;
      const crack = (px * 7 + py * 2) % 19 === 0;
      if (crack) return topRamp.deep;
      if (cobble) return topRamp.shadow;
      if (nx < -0.25 && ny < 0.15) return topRamp.highlight;
      if (nx > 0.35) return topRamp.shadow;
      return topRamp.mid;
    });
  });
}

/**
 * Stage 1: 3/4 Stone Masonry Block with chamfered top-left bevel, staggered
 * ashlar stone variation, horizontal belt course, and right-hand shadow return.
 */
export function drawMasonryBox(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: MaterialRamp,
  rightShadowCols = 4,
  withEaveShadow = false
): void {
  const splitX = x + w - rightShadowCols;
  for (let py = y; py < y + h; py++) {
    const dy = py - y;
    const row = Math.floor(dy / 3);
    const isMortarRow = dy % 3 === 2;
    const isUnderEave = withEaveShadow && dy <= 1;

    for (let px = x; px < x + w; px++) {
      const dx = px - x;
      const isRightFace = px >= splitX;
      const isLeftBevel = dx === 0 || (dy === 0 && !withEaveShadow && !isRightFace);
      const brickOffset = (row % 2) * 3;
      const isMortarCol = (dx + brickOffset) % 6 === 0;
      const stoneVar = ((px * 13 + py * 7) % 17) === 0;

      if (isRightFace) {
        if (isUnderEave || isMortarRow) {
          buf.setPixel(px, py, ramp.deep);
        } else {
          buf.setPixel(px, py, stoneVar ? ramp.deep : ramp.shadow);
        }
      } else if (isUnderEave) {
        buf.setPixel(px, py, dy === 0 ? ramp.deep : ramp.shadow);
      } else if (isLeftBevel) {
        buf.setPixel(px, py, ramp.highlight);
      } else if (isMortarRow || isMortarCol) {
        buf.setPixel(px, py, ramp.shadow);
      } else if (stoneVar) {
        buf.setPixel(px, py, ramp.highlight);
      } else {
        buf.setPixel(px, py, ramp.mid);
      }
    }
  }
}

/**
 * Stage 1B: Cylindrical / Octagonal 3/4 Tower with vertical tonal curvature,
 * ashlar stone courses, and upper rim cornice.
 */
export function drawCylindricalTower(
  buf: PixelBuffer,
  cx: number,
  topY: number,
  halfW: number,
  height: number,
  ramp: MaterialRamp,
  bandRamp?: MaterialRamp
): void {
  for (let dy = 0; dy < height; dy++) {
    const py = topY + dy;
    const isBelt = dy === 0 || dy === height - 1 || dy === Math.floor(height * 0.45);
    const mortarRow = dy % 4 === 3;
    for (let dx = -halfW; dx <= halfW; dx++) {
      const nx = dx / (halfW || 1);
      if (isBelt && bandRamp) {
        buf.setPixel(
          cx + dx,
          py,
          nx < -0.3 ? bandRamp.highlight : nx > 0.35 ? bandRamp.deep : bandRamp.mid
        );
      } else if (nx > 0.45) {
        buf.setPixel(cx + dx, py, mortarRow ? ramp.deep : ramp.shadow);
      } else if (nx < -0.35) {
        buf.setPixel(cx + dx, py, mortarRow ? ramp.mid : ramp.highlight);
      } else {
        const brick = (Math.floor(dy / 4) % 2 === 0 ? cx + dx : cx + dx + 3) % 5 === 0;
        buf.setPixel(cx + dx, py, mortarRow || brick ? ramp.shadow : ramp.mid);
      }
    }
  }
}

/**
 * Stage 1C: Half-Timbered Medieval Guild Wall with oak beams, diagonal bracing,
 * and recessed cream/sandstone plaster.
 */
export function drawTimberWall(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  plasterRamp: MaterialRamp = RAMPS.sandstone,
  beamRamp: MaterialRamp = RAMPS.timber
): void {
  drawMasonryBox(buf, x, y, w, h, plasterRamp, Math.max(3, Math.round(w * 0.18)), true);
  // Top & bottom horizontal oak beams
  buf.fillRect(x, y, w, 2, beamRamp.mid);
  buf.fillRect(x, y, w - 3, 1, beamRamp.highlight);
  buf.fillRect(x, y + h - 2, w, 2, beamRamp.shadow);
  // Corner & center vertical posts
  buf.fillRect(x, y, 2, h, beamRamp.mid);
  buf.fillRect(x + w - 3, y, 3, h, beamRamp.deep);
  if (w >= 12) {
    const mid = x + Math.floor(w / 2);
    buf.fillRect(mid, y, 2, h, beamRamp.shadow);
    // Subtle X-brace on sunlit left bay
    buf.drawLine(x + 2, y + 2, mid - 1, y + h - 3, beamRamp.shadow);
  }
}

/**
 * Stage 2: Peaked / Hipped Shingled Roof with scalloped 2px tile courses,
 * top-left highlights, bright ridge cap, and dark underside eave.
 */
export function drawShingledRoof(
  buf: PixelBuffer,
  cx: number,
  topY: number,
  halfW: number,
  height: number,
  ramp: MaterialRamp,
  ridgeRamp: MaterialRamp = ramp,
  curved = false
): void {
  buf.layer((sub) => {
    for (let dy = 0; dy < height; dy++) {
      const progress = dy / Math.max(1, height - 1);
      const eased = curved ? Math.pow(progress, 1.18) : progress;
      const span = Math.round(1 + eased * (halfW - 1));
      const py = topY + dy;
      const shingleRow = Math.floor(dy / 2);

      for (let dx = -span; dx <= span; dx++) {
        const px = cx + dx;
        const isRidge = Math.abs(dx) <= 1 && dy < 3;
        const isEave = dy >= height - 2;
        const scallop = (px + shingleRow * 2) % 4 === 0;
        const dither = (px + py) % 2 === 0;

        if (isEave) {
          sub.setPixel(px, py, dy === height - 1 ? ramp.deep : ramp.shadow);
        } else if (isRidge) {
          sub.setPixel(px, py, ridgeRamp.highlight);
        } else if (dx > span * 0.22) {
          sub.setPixel(px, py, scallop ? ramp.deep : ramp.shadow);
        } else if (dx < -span * 0.32) {
          sub.setPixel(px, py, scallop && dither ? ramp.mid : ramp.highlight);
        } else {
          sub.setPixel(px, py, scallop ? ramp.shadow : ramp.mid);
        }
      }
    }
  });
}

/**
 * Stage 3: Castle Battlements / Crenellations with deep crenellation backing.
 */
export function drawCrenellations(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  ramp: MaterialRamp
): void {
  for (let px = x; px < x + w; px++) {
    const rel = px - x;
    const isMerlon = rel % 4 < 2;
    const isRight = px > x + w - 4;
    if (isMerlon) {
      buf.setPixel(px, y, isRight ? ramp.mid : ramp.highlight);
      buf.setPixel(px, y + 1, isRight ? ramp.shadow : ramp.mid);
    }
    buf.setPixel(px, y + 2, isRight ? ramp.deep : ramp.shadow);
  }
}

/**
 * Stage 4: Arched Portal with beveled voussoir stones, keystone, VOID interior,
 * and optional iron portcullis or studded wooden plank door.
 */
export function drawArchedPortal(
  buf: PixelBuffer,
  cx: number,
  bottomY: number,
  halfW: number,
  height: number,
  frameRamp: MaterialRamp,
  style: 'void' | 'portcullis' | 'wood' = 'void'
): void {
  const topY = bottomY - height;
  for (let py = topY - 1; py <= bottomY; py++) {
    const dy = py - topY;
    const archFactor = dy < halfW ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - dy / halfW, 2))) : 1;
    const outerSpan = Math.round((halfW + 1.4) * archFactor);
    const innerSpan = Math.max(0, outerSpan - 1.4);

    for (let dx = -Math.round(outerSpan); dx <= Math.round(outerSpan); dx++) {
      const px = cx + dx;
      if (Math.abs(dx) > innerSpan || py <= topY) {
        const isKeystone = py <= topY && Math.abs(dx) <= 1;
        buf.setPixel(
          px,
          py,
          isKeystone ? frameRamp.highlight : dx < 0 ? frameRamp.highlight : frameRamp.shadow
        );
      } else if (style === 'void') {
        buf.setPixel(px, py, VOID);
      } else if (style === 'portcullis') {
        const isBar = Math.abs(dx) % 2 === 0 || py % 3 === 0;
        buf.setPixel(px, py, isBar ? RAMPS.slate.mid : VOID);
      } else {
        const isPlank = dx % 2 === 0;
        const isBand = py === topY + 3 || py === bottomY - 2;
        buf.setPixel(
          px,
          py,
          isBand ? RAMPS.slate.mid : isPlank ? RAMPS.timber.mid : RAMPS.timber.shadow
        );
      }
    }
  }
}

/**
 * Stage 4B: Stained-Glass / Lancet Window with glowing multi-stop core.
 */
export function drawGlowingWindow(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  glowRamp: MaterialRamp = RAMPS.gold,
  frameColor: string = RAMPS.slate.shadow
): void {
  buf.fillRect(x - 1, y - 1, w + 2, h + 2, frameColor);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const isCenter = px === x + Math.floor(w / 2) && py < y + Math.ceil(h * 0.65);
      buf.setPixel(px, py, isCenter ? glowRamp.highlight : py === y ? glowRamp.mid : glowRamp.shadow);
    }
  }
}

/**
 * Stage 4C: Glowing Wall Brazier / Torch Prop.
 */
export function drawBrazier(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  phaseRad = 0,
  flameRamp: MaterialRamp = RAMPS.lava
): void {
  buf.fillRect(cx - 1, cy + 1, 3, 2, RAMPS.obsidian.mid);
  buf.setPixel(cx, cy + 3, RAMPS.obsidian.deep);
  const flicker = Math.sin(phaseRad) > 0;
  buf.setPixel(cx - 1, cy, flameRamp.mid);
  buf.setPixel(cx + 1, cy, flameRamp.shadow);
  buf.setPixel(cx, cy, flameRamp.highlight);
  buf.setPixel(cx, cy - 1, flicker ? '#FFFFFF' : flameRamp.highlight);
}

/**
 * Stage 5A (Kinetic): Swinging Golden Lantern with chain & core glow.
 */
export function drawSwingingLantern(
  buf: PixelBuffer,
  x: number,
  y: number,
  swayX: number,
  flicker: number
): void {
  buf.layer((sub) => {
    const lx = Math.round(x + swayX);
    sub.drawLine(x, y - 3, lx, y - 1, RAMPS.slate.mid);
    sub.fillRect(lx - 1, y, 3, 1, RAMPS.timber.deep);
    sub.fillRect(
      lx - 1,
      y + 1,
      3,
      2,
      flicker > 0.5 ? RAMPS.gold.mid : RAMPS.gold.shadow
    );
    sub.setPixel(lx, y + 1, RAMPS.gold.highlight);
    sub.setPixel(lx, y + 3, RAMPS.gold.deep);
  });
}

/**
 * Stage 5B (Kinetic): Animated Waving Team-Color Pennant Banner.
 */
export function drawWavingBanner(
  buf: PixelBuffer,
  poleX: number,
  poleTopY: number,
  poleBottomY: number,
  phaseRad: number,
  ramp: MaterialRamp = RAMPS.magenta,
  trimRamp?: MaterialRamp
): void {
  buf.layer((sub) => {
    sub.drawLine(poleX, poleTopY, poleX, poleBottomY, RAMPS.bone.highlight);
    sub.setPixel(poleX, poleTopY, RAMPS.gold.highlight);
    for (let i = 1; i <= 8; i++) {
      const wave = Math.round(Math.sin(phaseRad - i * 0.65) * 1.15);
      sub.setPixel(poleX + i, poleTopY + 1 + wave, i < 4 ? ramp.mid : ramp.highlight);
      if (i < 7) {
        const trim = trimRamp && i === 3;
        sub.setPixel(poleX + i, poleTopY + 2 + wave, trim ? trimRamp.highlight : ramp.shadow);
      }
      if (i < 4) {
        sub.setPixel(poleX + i, poleTopY + 3 + wave, ramp.deep);
      }
    }
  });
}

/**
 * Stage 5C (Kinetic): Toothed Interlocking Clockwork Gear with hollow spokes.
 */
export function drawClockworkGear(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  radius: number,
  teeth: number,
  angleRad: number,
  ramp: MaterialRamp = RAMPS.gold,
  coreColor: string = RAMPS.magenta.highlight
): void {
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, radius, radius, (nx, ny) => {
      const r2 = nx * nx + ny * ny;
      if (r2 < 0.16) return coreColor;
      if (r2 > 0.25 && r2 < 0.55 && Math.abs(nx) > 0.25 && Math.abs(ny) > 0.25) {
        return ramp.deep;
      }
      if (nx < -0.2 || ny < -0.2) return ramp.highlight;
      if (nx > 0.35 || ny > 0.35) return ramp.deep;
      return ramp.mid;
    });
    for (let i = 0; i < teeth; i++) {
      const a = angleRad + (i * Math.PI * 2) / teeth;
      const tx = cx + Math.cos(a) * (radius + 1.25);
      const ty = cy + Math.sin(a) * (radius + 1.25);
      sub.setPixel(tx, ty, Math.sin(a) < 0 ? ramp.highlight : ramp.mid);
    }
  });
}

/**
 * Stage 5D (Kinetic): Multi-stop Flickering Flame / Furnace Fire.
 */
export function drawAnimatedFlame(
  buf: PixelBuffer,
  cx: number,
  baseY: number,
  halfW: number,
  maxH: number,
  phaseRad: number,
  ramp: MaterialRamp = RAMPS.lava
): void {
  for (let dx = -halfW; dx <= halfW; dx++) {
    const distNorm = Math.abs(dx) / (halfW + 0.5);
    const localH = Math.max(
      1,
      Math.round((1 - distNorm * 0.65) * maxH + Math.sin(phaseRad * 2 + dx * 1.3) * 1.4)
    );
    for (let dy = 0; dy < localH; dy++) {
      const py = baseY - dy;
      const color =
        dy === 0 && Math.abs(dx) <= 1
          ? '#FFFFFF'
          : dy <= 1 && Math.abs(dx) <= 1
            ? ramp.highlight
            : dy < localH * 0.5
              ? ramp.mid
              : dy < localH * 0.82
                ? ramp.shadow
                : ramp.deep;
      buf.setPixel(cx + dx, py, color);
    }
  }
}

export { INK, VOID };
