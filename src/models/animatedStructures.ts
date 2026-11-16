import {
  VOID,
  drawAnimatedFlame,
  drawArchedPortal,
  drawBrazier,
  drawClockworkGear,
  drawCrenellations,
  drawCylindricalTower,
  drawGlowingWindow,
  drawGroundPlinth,
  drawMasonryBox,
  drawShingledRoof,
  drawSwingingLantern,
  drawTimberWall,
  drawWavingBanner,
} from '../engine/architectureGrammar';
import { RAMPS } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef } from './types';

/**
 * ============================================================================
 * KINETIC / ANIMATED ARCHITECTURAL MODELS (8 MODELS, 54x64 .. 64x62)
 * ============================================================================
 * Only logically moving parts animate inside isolated `buf.layer(...)`
 * calls, while stone masonry, plinths, and roofs remain locked.
 * ============================================================================
 */

function renderBoneWindmill(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 62);
  const t = (frame / total) * Math.PI * 2;
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  // Layer 0: Earth & timber foundation plinth
  drawGroundPlinth(buf, 29, 54, 21, 5, RAMPS.sandstone, RAMPS.timber);

  // Layer 1: Tapered cylindrical necro-slate tower with timber hoops & pulley hoist
  buf.layer((sub) => {
    for (let y = 21; y <= 53; y++) {
      const p = (y - 21) / 32;
      const hw = Math.round(7 + p * 6);
      const mortarRow = y % 4 === 0;
      for (let x = 29 - hw; x <= 29 + hw; x++) {
        const nx = (x - 29) / hw;
        if (y === 30 || y === 40) {
          sub.setPixel(x, y, nx > 0.3 ? RAMPS.timber.deep : RAMPS.timber.mid);
        } else if (nx > 0.38) {
          sub.setPixel(x, y, mortarRow ? RAMPS.slate.deep : RAMPS.slate.shadow);
        } else if (nx < -0.45) {
          sub.setPixel(x, y, RAMPS.slate.highlight);
        } else {
          sub.setPixel(x, y, mortarRow && x % 4 === 0 ? RAMPS.slate.shadow : RAMPS.slate.mid);
        }
      }
    }
    // Hanging grain hoist beam & flour sack on left
    sub.fillRect(13, 33, 6, 2, RAMPS.timber.mid);
    sub.fillRect(13, 35, 4, 4, RAMPS.sail.mid);
    sub.setPixel(14, 36, RAMPS.sail.highlight);
  });

  // Layer 2: Giant curved bone rib buttresses & glowing base crystals
  buf.layer((sub) => {
    sub.drawRibArch(12, 52, 9, 41, 18, 32, 2, RAMPS.bone);
    sub.drawRibArch(46, 52, 49, 41, 40, 32, 2, RAMPS.bone);
    sub.drawCrystal(13, 53, 7, -1, pulse, RAMPS.magenta);
    sub.drawCrystal(45, 53, 7, 1, 1 - pulse, RAMPS.magenta);
  });

  // Layer 3: Conical bone-plated dome & waving K1/K2 banner
  buf.layer((sub) => {
    for (let y = 11; y <= 21; y++) {
      const hw = Math.round(((y - 11) / 10) * 9.5);
      for (let x = 29 - hw; x <= 29 + hw; x++) {
        const nx = (x - 29) / (hw || 1);
        sub.setPixel(
          x,
          y,
          nx < -0.25 ? RAMPS.bone.highlight : nx > 0.35 ? RAMPS.bone.shadow : RAMPS.bone.mid
        );
      }
    }
  });
  drawWavingBanner(buf, 29, 3, 11, t * 2, RAMPS.magenta, RAMPS.cyanMask);

  // Layer 4: Boss skull portal archway & glowing doorway braziers
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 53, 4.5, 8, RAMPS.bone, 'void');
    sub.drawSkull(29, 42, 'medium', RAMPS.magenta.highlight, RAMPS.bone);
  });

  // Layer 5 (Kinetic): Huge 4-blade stitched-sail rotor (r=19.5px)
  buf.layer((blades) => {
    const cx = 29;
    const cy = 24;
    for (let b = 0; b < 4; b++) {
      const angle = t + (b * Math.PI) / 2;
      blades.drawRotatedRect(cx, cy, 19.5, 0.95, angle, (u) =>
        u < 0.28 ? RAMPS.bone.highlight : RAMPS.timber.mid
      );
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const perpX = -sin;
      const perpY = cos;
      for (let r = 5.5; r <= 18.8; r += 0.55) {
        for (let w = 1; w <= 4.6; w += 0.55) {
          const px = Math.round(cx + cos * r + perpX * w);
          const py = Math.round(cy + sin * r + perpY * w);
          const isEdge = r > 17.8 || w > 3.9;
          const isRib = Math.round(r) % 4 === 0;
          const color = isEdge
            ? RAMPS.timber.shadow
            : isRib
              ? RAMPS.timber.highlight
              : (Math.round(r) + Math.round(w)) % 2 === 0
                ? RAMPS.sail.highlight
                : RAMPS.sail.mid;
          blades.setPixel(px, py, color);
        }
      }
    }
    blades.fillEllipse(cx, cy, 3, 3, (nx, ny) =>
      nx * nx + ny * ny < 0.35
        ? pulse > 0.5
          ? '#FFFFFF'
          : RAMPS.magenta.highlight
        : RAMPS.bone.highlight
    );
  });

  return buf;
}

function renderGuildWatermill(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 58);
  const t = (frame / total) * Math.PI * 2;
  const flicker = (Math.sin(t * 3) + 1) * 0.5;

  // Layer 0: Riverbank plinth + animated foaming millpond
  drawGroundPlinth(buf, 30, 50, 23, 5.5, RAMPS.slate, RAMPS.timber);
  buf.fillEllipse(39, 49, 11, 3, (nx, ny, px) => {
    const foam = (px + Math.floor(frame * 1.5)) % 4 === 0;
    return foam ? RAMPS.ice.highlight : ny < 0 ? RAMPS.ice.mid : RAMPS.ice.shadow;
  });

  // Layer 1: Two-story timber & stone millhouse with dormer & glowing window
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 32, 22, 17, RAMPS.slate, 4, true);
    drawTimberWall(sub, 8, 20, 24, 12, RAMPS.sandstone, RAMPS.timber);
    drawArchedPortal(sub, 16, 49, 3.5, 8, RAMPS.timber, 'wood');
    drawGlowingWindow(sub, 12, 23, 4, 4, RAMPS.gold, RAMPS.timber.deep);
    drawGlowingWindow(sub, 22, 23, 4, 4, RAMPS.gold, RAMPS.timber.deep);
  });

  // Layer 2: Steep shingled guild roof (K1_MASK) + moss tufts
  drawShingledRoof(buf, 20, 8, 14, 12, RAMPS.magenta, RAMPS.gold, false);
  buf.layer((sub) => {
    sub.fillRect(10, 16, 4, 3, RAMPS.moss.mid);
    sub.setPixel(11, 15, RAMPS.moss.highlight);
    sub.fillRect(19, 4, 4, 4, RAMPS.slate.mid); // Chimney
  });

  // Layer 3 (Kinetic): Elevated mossy stone aqueduct + cascading waterfall
  buf.layer((sub) => {
    drawMasonryBox(sub, 31, 16, 19, 5, RAMPS.slate, 2);
    sub.fillRect(31, 15, 17, 2, RAMPS.moss.mid);
    for (let x = 31; x <= 48; x++) {
      const wave = (x - Math.floor(frame * 1.6)) % 3 === 0;
      sub.setPixel(x, 17, wave ? RAMPS.ice.highlight : RAMPS.ice.mid);
    }
    for (let y = 17; y <= 46; y++) {
      const wx = 47 + Math.round(Math.sin(y * 0.45 - t * 2) * 0.7);
      const foam = (y - frame * 2) % 4 === 0;
      sub.setPixel(wx, y, foam ? RAMPS.ice.highlight : RAMPS.ice.mid);
      sub.setPixel(wx + 1, y, foam ? '#FFFFFF' : RAMPS.ice.shadow);
    }
  });

  // Layer 4 (Kinetic): 10-paddle oak & iron waterwheel
  buf.layer((wheel) => {
    const wx = 39;
    const wy = 36;
    const r = 10.5;
    for (let a = 0; a < 64; a++) {
      const ang = (a / 64) * Math.PI * 2;
      wheel.setPixel(
        wx + Math.cos(ang) * r,
        wy + Math.sin(ang) * r,
        Math.sin(ang) < 0 ? RAMPS.timber.highlight : RAMPS.timber.shadow
      );
      wheel.setPixel(
        wx + Math.cos(ang) * (r - 1.2),
        wy + Math.sin(ang) * (r - 1.2),
        RAMPS.timber.mid
      );
    }
    for (let s = 0; s < 10; s++) {
      const ang = t + (s * Math.PI * 2) / 10;
      wheel.drawRotatedRect(wx, wy, 12.5, 0.75, ang, (u) =>
        u > 0.78 ? RAMPS.slate.highlight : RAMPS.timber.mid
      );
    }
    wheel.fillEllipse(wx, wy, 2.5, 2.5, RAMPS.gold.mid);
    wheel.setPixel(wx, wy, RAMPS.gold.highlight);
  });

  // Layer 5 (Kinetic): Swinging golden lantern under eaves
  drawSwingingLantern(buf, 29, 29, Math.round(Math.sin(t) * 0.8), flicker);

  return buf;
}

function renderArcaneSpire(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(54, 64);
  const t = (frame / total) * Math.PI * 2;
  const hoverY = Math.round(Math.sin(t) * 2.5);
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  // Layer 0: Marble & gold foundation plinth
  drawGroundPlinth(buf, 27, 56, 18, 5, RAMPS.marble, RAMPS.gold);

  // Layer 1: Octagonal marble sanctuary base with gold trim & portal
  buf.layer((sub) => {
    drawCylindricalTower(sub, 27, 36, 11, 19, RAMPS.marble, RAMPS.gold);
    drawArchedPortal(sub, 27, 55, 4.5, 10, RAMPS.gold, 'void');
    sub.fillRect(25, 48, 5, 6, RAMPS.magenta.shadow);
    sub.setPixel(27, 50, '#FFFFFF');
    drawGlowingWindow(sub, 19, 41, 2, 4, RAMPS.cyanMask, RAMPS.gold.shadow);
    drawGlowingWindow(sub, 33, 41, 2, 4, RAMPS.cyanMask, RAMPS.gold.shadow);
  });

  // Layer 2: Four soaring marble & gold flying buttress cradles
  buf.layer((sub) => {
    sub.drawRibArch(15, 38, 11, 20, 20, 14, 2, RAMPS.marble);
    sub.drawRibArch(39, 38, 43, 20, 34, 14, 2, RAMPS.marble);
    sub.fillRect(19, 13, 3, 2, RAMPS.gold.highlight);
    sub.fillRect(32, 13, 3, 2, RAMPS.gold.highlight);
  });

  // Layer 3 (Kinetic): Giant levitating rotating octahedral K1 crystal
  buf.layer((crystal) => {
    const cy = 22 + hoverY;
    const facetShift = Math.round(Math.sin(t) * 3);
    for (let dy = -9; dy <= 9; dy++) {
      const hw = Math.max(0, Math.round((1 - Math.abs(dy) / 9.5) * 6));
      for (let dx = -hw; dx <= hw; dx++) {
        const isBright = dx < facetShift;
        const c =
          dy < -4 && isBright
            ? '#FFFFFF'
            : isBright
              ? RAMPS.magenta.highlight
              : dx > 2
                ? RAMPS.magenta.deep
                : RAMPS.magenta.mid;
        crystal.setPixel(27 + dx, cy + dy, c);
      }
    }
  });

  // Layer 4 (Kinetic): Three orbiting golden-cyan-magenta rune spheres
  for (let i = 0; i < 3; i++) {
    const a = t + (i * Math.PI * 2) / 3;
    const ox = Math.round(27 + Math.cos(a) * 16);
    const oy = Math.round(23 + Math.sin(a) * 4.5);
    buf.layer((orb) => {
      orb.fillRect(
        ox - 1,
        oy - 1,
        3,
        3,
        i === 1 ? RAMPS.cyanMask.mid : Math.sin(a) > 0 ? RAMPS.magenta.highlight : RAMPS.gold.mid
      );
      orb.setPixel(ox, oy, pulse > 0.5 ? '#FFFFFF' : RAMPS.gold.highlight);
    });
  }

  return buf;
}

function renderInfernalForge(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 58);
  const t = (frame / total) * Math.PI * 2;
  const breath = (Math.sin(t) + 1) * 0.5;
  const strike = Math.max(0, Math.sin(t * 2));

  // Layer 0: Basalt plinth with glowing magma veins
  drawGroundPlinth(buf, 30, 50, 22, 5.5, RAMPS.obsidian, RAMPS.lava);
  buf.fillRect(19, 49, 4, 1, RAMPS.lava.highlight);
  buf.fillRect(39, 50, 3, 1, RAMPS.lava.mid);

  // Layer 1 (Kinetic): Left accordion leather & bone bellows
  buf.layer((sub) => {
    const stretch = Math.round(breath * 4);
    const bx = 11 - stretch;
    for (let x = bx; x <= 20; x++) {
      const u = (x - bx) / (20 - bx || 1);
      const hh = Math.round(6 - u * 3.5);
      const fold = (x - bx) % 2 === 0;
      for (let y = 40 - hh; y <= 40 + hh; y++) {
        sub.setPixel(x, y, fold ? RAMPS.timber.mid : RAMPS.sail.shadow);
      }
    }
    sub.fillRect(bx - 2, 33, 4, 2, RAMPS.bone.highlight);
    sub.fillRect(bx - 2, 45, 4, 2, RAMPS.bone.shadow);
  });

  // Layer 2: Horned ironclad obsidian furnace with live hearth inferno
  buf.layer((sub) => {
    drawMasonryBox(sub, 19, 23, 19, 26, RAMPS.obsidian, 4, true);
    drawMasonryBox(sub, 24, 13, 9, 10, RAMPS.obsidian, 3);
    sub.fillRect(23, 12, 11, 2, RAMPS.gold.mid);
    // Giant sweeping horned chimney crest
    sub.drawRibArch(20, 23, 16, 15, 23, 12, 2, RAMPS.bone);
    sub.drawRibArch(37, 23, 41, 15, 34, 12, 2, RAMPS.bone);
    // Fiery furnace maw + multi-stop animated inferno
    drawArchedPortal(sub, 28, 49, 5, 10, RAMPS.gold, 'void');
    drawAnimatedFlame(sub, 28, 48, 4, 6 + Math.round(breath * 3), t, RAMPS.lava);
  });

  // Layer 3 (Kinetic): Rising forge embers & chimney sparks
  buf.layer((sparks) => {
    for (let i = 0; i < 4; i++) {
      const p = (frame / total + i / 4) % 1;
      const sy = Math.round(11 - p * 9);
      const sx = Math.round(28 + Math.sin(p * 6 + i) * 2);
      sparks.fillRect(sx, sy, 2, 2, p < 0.45 ? RAMPS.lava.highlight : RAMPS.magenta.highlight);
    }
  });

  // Layer 4 (Kinetic): Right anvil, glowing ingot & brass trip-hammer
  buf.layer((sub) => {
    sub.fillRect(42, 43, 8, 5, RAMPS.obsidian.deep);
    sub.fillRect(41, 40, 10, 3, RAMPS.slate.highlight);
    sub.fillRect(43, 39, 4, 1, strike > 0.85 ? '#FFFFFF' : RAMPS.lava.highlight);

    sub.fillRect(51, 27, 3, 21, RAMPS.timber.mid);
    const angle = -0.7 + strike * 0.78;
    const hx = Math.round(51 - Math.cos(angle) * 8);
    const hy = Math.round(31 + Math.sin(angle) * 6.5);
    sub.drawLine(51, 31, hx, hy, RAMPS.timber.highlight, 2);
    sub.fillRect(hx - 2, hy - 2, 5, 5, RAMPS.gold.mid);
    sub.fillRect(hx - 1, hy - 2, 3, 1, RAMPS.gold.highlight);
  });

  if (strike > 0.88) {
    buf.layer((sparks) => {
      sparks.setPixel(41, 35, RAMPS.gold.highlight);
      sparks.setPixel(46, 33, RAMPS.lava.highlight);
      sparks.setPixel(39, 37, '#FFFFFF');
      sparks.setPixel(48, 36, '#FFFFFF');
    });
  }

  return buf;
}

function renderGuildClocktower(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 64);
  const t = (frame / total) * Math.PI * 2;

  // Layer 0: Sandstone terrace plinth
  drawGroundPlinth(buf, 28, 56, 19, 5, RAMPS.sandstone, RAMPS.timber);

  // Layer 1: Lower arched masonry piers framing swinging brass pendulum
  buf.layer((sub) => {
    drawMasonryBox(sub, 15, 39, 7, 16, RAMPS.sandstone, 2);
    drawMasonryBox(sub, 34, 39, 7, 16, RAMPS.sandstone, 3);
    sub.fillRect(21, 39, 14, 3, RAMPS.timber.mid);
    drawBrazier(sub, 14, 51, 0.4, RAMPS.lava);
    drawBrazier(sub, 42, 51, 1.9, RAMPS.lava);
  });

  // Layer 2 (Kinetic): Swinging brass pendulum inside lower open gallery
  buf.layer((pend) => {
    const swing = Math.PI / 2 + Math.sin(t) * 0.52;
    const px = Math.round(28 + Math.cos(swing) * 11);
    const py = Math.round(41 + Math.sin(swing) * 11);
    pend.drawLine(28, 41, px, py, RAMPS.gold.mid);
    pend.fillEllipse(px, py, 2.8, 2.8, (nx) =>
      nx < 0 ? RAMPS.gold.highlight : RAMPS.gold.shadow
    );
    pend.setPixel(px, py, RAMPS.magenta.highlight);
  });

  // Layer 3: Upper clockwork belfry & illuminated guild dial
  buf.layer((sub) => {
    drawMasonryBox(sub, 15, 18, 26, 22, RAMPS.sandstone, 5, true);
    sub.fillRect(14, 17, 28, 2, RAMPS.slate.mid);
  });

  // Layer 4 (Kinetic): Three counter-rotating interlocked brass gears (10:8:6 ratio)
  drawClockworkGear(buf, 23, 28, 4.5, 10, t, RAMPS.gold, RAMPS.magenta.highlight);
  drawClockworkGear(buf, 32, 32, 3.3, 8, -t * 1.25, RAMPS.gold, RAMPS.cyanMask.highlight);
  drawClockworkGear(buf, 33, 23, 2.5, 6, t * 1.667, RAMPS.gold, RAMPS.magenta.mid);

  // Layer 5: Steep shingled roof (K1) + sweeping observatory brass spyglass
  drawShingledRoof(buf, 28, 7, 15, 11, RAMPS.magenta, RAMPS.gold, true);
  buf.layer((scope) => {
    const sweep = -0.55 + Math.sin(t) * 0.35;
    scope.drawRotatedRect(28, 10, 12, 1.5, sweep, (u) =>
      u > 0.85 ? RAMPS.cyanMask.highlight : RAMPS.gold.mid
    );
  });

  return buf;
}

function renderSkyGalleonDock(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(64, 62);
  const t = (frame / total) * Math.PI * 2;
  const bob = Math.round(Math.sin(t) * 1.8);
  const flicker = (Math.sin(t * 3) + 1) * 0.5;

  // Layer 0: Mooring dock stone & oak plinth
  drawGroundPlinth(buf, 32, 54, 24, 5.5, RAMPS.sandstone, RAMPS.timber);

  // Layer 1: Left fortified mooring pier tower with crane boom & lantern
  buf.layer((sub) => {
    drawMasonryBox(sub, 8, 36, 10, 17, RAMPS.slate, 3);
    drawTimberWall(sub, 7, 25, 12, 11, RAMPS.sandstone, RAMPS.timber);
    drawGlowingWindow(sub, 10, 28, 3, 3, RAMPS.gold, RAMPS.timber.deep);
    sub.fillRect(11, 18, 3, 7, RAMPS.timber.mid);
    sub.fillRect(11, 17, 14, 2, RAMPS.timber.highlight);
  });
  drawSwingingLantern(buf, 24, 22, Math.round(Math.cos(t) * 0.8), flicker);

  // Layer 2 (Kinetic): Moored gently bobbing sky-galleon airship
  buf.layer((ship) => {
    // Striped K1/K2 dirigible gas envelope
    ship.fillEllipse(40, 17 + bob, 16, 8, (nx, ny, px) => {
      if (px % 6 === 0) return RAMPS.magenta.mid;
      if (px % 12 === 3) return RAMPS.cyanMask.mid;
      if (ny > 0.45) return RAMPS.sail.shadow;
      if (ny < -0.35 && nx < 0.2) return RAMPS.sail.highlight;
      return RAMPS.sail.mid;
    });
    // Suspension rigging cables
    for (const rx of [31, 40, 49]) {
      ship.drawLine(rx, 25 + bob, rx, 32 + bob, RAMPS.timber.highlight);
    }
    // Ribbed oak airship hull gondola with lit portholes
    ship.fillEllipse(40, 36 + bob, 14, 5, (nx, ny) =>
      ny > 0.3 ? RAMPS.timber.deep : nx < -0.25 ? RAMPS.timber.highlight : RAMPS.timber.mid
    );
    for (let rx = 31; rx <= 49; rx += 5) {
      ship.drawLine(rx, 32 + bob, rx - 1, 40 + bob, RAMPS.bone.highlight);
      ship.setPixel(rx + 2, 35 + bob, RAMPS.gold.highlight);
    }
    ship.drawSkull(26, 34 + bob, 'mini', RAMPS.magenta.highlight, RAMPS.bone);

    // Spinning stern brass-and-bone propeller
    const propSpan = Math.round(Math.sin(t * 4) * 4.5);
    ship.fillRect(54, 35 + bob, 2, 2, RAMPS.gold.mid);
    ship.drawLine(56, 36 + bob - propSpan, 56, 36 + bob + propSpan, RAMPS.bone.highlight);
  });

  // Layer 3 (Kinetic): Waving banner atop dirigible crown
  drawWavingBanner(buf, 40, 2 + bob, 10 + bob, t * 2, RAMPS.magenta, RAMPS.cyanMask);

  return buf;
}

function renderTitanFoundry(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 60);
  const phase = frame / total;
  const t = phase * Math.PI * 2;
  const tilt = Math.sin(t);

  // Layer 0: Basalt industrial plinth with molten slag trench
  drawGroundPlinth(buf, 30, 52, 22, 5.5, RAMPS.obsidian, RAMPS.lava);

  // Layer 1: Heavy industrial stone & brass gantry tower
  buf.layer((sub) => {
    drawMasonryBox(sub, 10, 22, 16, 29, RAMPS.slate, 4, true);
    drawMasonryBox(sub, 38, 33, 12, 18, RAMPS.obsidian, 3, true);
    // Overhead iron crane beam spanning foundry bay
    sub.fillRect(14, 15, 31, 4, RAMPS.slate.mid);
    sub.fillRect(14, 15, 26, 1, RAMPS.slate.highlight);
    sub.fillRect(42, 19, 3, 14, RAMPS.timber.mid);
    // Glowing brick furnace arch
    drawArchedPortal(sub, 18, 51, 4, 8, RAMPS.gold, 'void');
    drawAnimatedFlame(sub, 18, 50, 3, 5, t, RAMPS.lava);
  });

  // Layer 2 (Kinetic): Exposed gear hoist turning overhead
  drawClockworkGear(buf, 18, 17, 4, 8, t, RAMPS.gold, RAMPS.magenta.highlight);

  // Layer 3 (Kinetic): Tilting molten slag crucible + lava pour stream + ingot mold
  buf.layer((pour) => {
    const cx = 31;
    const cy = 26 + Math.round(tilt * 1.5);
    pour.fillEllipse(cx, cy, 6, 5, (nx, ny) =>
      ny < -0.2 ? RAMPS.lava.highlight : nx > 0.3 ? RAMPS.obsidian.deep : RAMPS.slate.mid
    );
    pour.fillRect(cx - 4, cy - 3, 8, 2, RAMPS.lava.highlight);
    // Animated molten lava cascade into floor mold
    for (let y = cy + 3; y <= 46; y++) {
      const pulse = (y - frame * 2) % 3 === 0;
      pour.setPixel(cx + 1, y, pulse ? '#FFFFFF' : RAMPS.lava.highlight);
      pour.setPixel(cx + 2, y, RAMPS.lava.mid);
    }
    // Floor casting basin glowing with molten gold/lava
    pour.fillRect(26, 46, 12, 5, RAMPS.obsidian.shadow);
    pour.fillRect(28, 46, 8, 2, RAMPS.lava.highlight);
  });

  // Layer 4 (Kinetic): Rising steam puffs above casting basin
  buf.layer((steam) => {
    for (let i = 0; i < 3; i++) {
      const p = (phase + i / 3) % 1;
      const sy = Math.round(43 - p * 12);
      const sx = Math.round(32 + Math.sin(p * 5 + i) * 3);
      steam.fillEllipse(sx, sy, 2, 1.5, p < 0.5 ? RAMPS.marble.highlight : RAMPS.marble.shadow);
    }
  });

  return buf;
}

function renderSummoningObelisk(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 62);
  const t = (frame / total) * Math.PI * 2;
  const hover = Math.round(Math.sin(t) * 2.5);
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  // Layer 0: Rune-carved stonehenge altar plinth with glowing magic circle
  drawGroundPlinth(buf, 28, 54, 21, 5.5, RAMPS.slate, RAMPS.obsidian);
  buf.fillEllipse(28, 53, 13, 3, (nx, ny, px) =>
    (px + frame) % 3 === 0 ? RAMPS.magenta.highlight : RAMPS.magenta.shadow
  );

  // Layer 1: Flanking curved monolith arches framing central obelisk
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 34, 7, 19, RAMPS.obsidian, 2);
    drawMasonryBox(sub, 40, 34, 7, 19, RAMPS.obsidian, 3);
    sub.setPixel(12, 40, RAMPS.cyanMask.highlight);
    sub.setPixel(43, 40, RAMPS.cyanMask.highlight);
    drawBrazier(sub, 12, 31, t, RAMPS.magenta);
    drawBrazier(sub, 43, 31, t + Math.PI, RAMPS.magenta);
  });

  // Layer 2 (Kinetic): Levitating fractured obsidian obelisk with vertical energy beam
  buf.layer((obelisk) => {
    // Ascending rune energy column
    for (let y = 14; y <= 50; y++) {
      const wave = (y + frame * 2) % 4 === 0;
      obelisk.setPixel(28, y, wave ? '#FFFFFF' : RAMPS.magenta.mid);
    }
    // Lower pedestal base
    drawMasonryBox(obelisk, 22, 42, 12, 11, RAMPS.obsidian, 3);
    // Floating fractured upper obelisk monolith
    for (let dy = 0; dy < 22; dy++) {
      const hw = Math.max(1, Math.round(1 + (dy / 21) * 5.5));
      const py = 10 + hover + dy;
      for (let dx = -hw; dx <= hw; dx++) {
        const isRune = dy > 6 && dy < 17 && Math.abs(dx) <= 1;
        obelisk.setPixel(
          28 + dx,
          py,
          isRune
            ? pulse > 0.5
              ? '#FFFFFF'
              : RAMPS.cyanMask.highlight
            : dx > hw * 0.3
              ? RAMPS.obsidian.deep
              : dx < -hw * 0.4
                ? RAMPS.slate.highlight
                : RAMPS.obsidian.mid
        );
      }
    }
  });

  // Layer 3 (Kinetic): Twin orbiting soul wisps
  for (let i = 0; i < 2; i++) {
    const a = t + i * Math.PI;
    const wx = Math.round(28 + Math.cos(a) * 14);
    const wy = Math.round(26 + Math.sin(a) * 4);
    buf.layer((wisp) => {
      wisp.fillRect(wx - 1, wy - 1, 3, 3, RAMPS.cyanMask.mid);
      wisp.setPixel(wx, wy, '#FFFFFF');
    });
  }

  return buf;
}

function renderAlchemistLab(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 60);
  const t = (frame / total) * Math.PI * 2;

  // Layer 0: Stone & timber workshop plinth
  drawGroundPlinth(buf, 29, 52, 22, 5.5, RAMPS.slate, RAMPS.timber);

  // Layer 1: Left stone apothecary annex + chimney & glowing burner
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 25, 19, 26, RAMPS.slate, 4, true);
    drawTimberWall(sub, 8, 17, 21, 9, RAMPS.sandstone, RAMPS.timber);
    drawGlowingWindow(sub, 12, 20, 4, 4, RAMPS.cyanMask, RAMPS.timber.deep);
    drawArchedPortal(sub, 18, 51, 4, 9, RAMPS.timber, 'wood');
    // Copper distillation pipe linking annex to vat
    sub.fillRect(26, 20, 12, 3, RAMPS.gold.mid);
    sub.fillRect(26, 20, 12, 1, RAMPS.gold.highlight);
  });
  drawShingledRoof(buf, 18, 7, 11, 10, RAMPS.magenta, RAMPS.gold, true);

  // Layer 2: Right alchemical furnace pedestal + animated burner flame
  buf.layer((sub) => {
    drawMasonryBox(sub, 31, 42, 18, 9, RAMPS.obsidian, 4);
    sub.fillRect(35, 44, 10, 6, VOID);
    drawAnimatedFlame(sub, 40, 49, 4, 5, t, RAMPS.lava);
  });

  // Layer 3 (Kinetic): Giant glass cauldron/vat with K1/K2 glowing elixir + rising bubbles
  buf.layer((vat) => {
    vat.fillEllipse(40, 31, 8.5, 10, (nx, ny) => {
      const shimmer = Math.sin(t + ny * 3) > 0.25;
      if (nx < -0.55) return RAMPS.ice.highlight;
      if (ny > 0.35) return RAMPS.magenta.deep;
      if (nx > 0.45) return RAMPS.magenta.shadow;
      return shimmer ? RAMPS.magenta.highlight : RAMPS.magenta.mid;
    });
    // Brass vat hoops
    vat.fillRect(32, 26, 17, 2, RAMPS.gold.mid);
    vat.fillRect(32, 36, 17, 2, RAMPS.gold.mid);
    vat.fillRect(36, 19, 9, 3, RAMPS.gold.highlight);
    // Animated rising K2 bubbles
    for (let b = 0; b < 3; b++) {
      const prog = ((frame / total) + b * 0.33) % 1;
      const by = Math.round(37 - prog * 13);
      const bx = Math.round(37 + b * 3 + Math.sin(t + b * 2) * 1.2);
      vat.fillRect(bx, by, 2, 2, prog > 0.65 ? '#FFFFFF' : RAMPS.cyanMask.highlight);
    }
  });

  // Layer 4 (Kinetic): Rising steam puffs above alembic neck
  for (let p = 0; p < 2; p++) {
    const prog = ((frame / total) + p * 0.5) % 1;
    const py = Math.round(16 - prog * 10);
    const px = Math.round(40 + Math.sin(t + p * 2) * 2);
    buf.layer((puff) => {
      puff.fillEllipse(px, py, 2.5 - prog, 2 - prog * 0.8, () =>
        prog > 0.5 ? RAMPS.ice.highlight : RAMPS.marble.highlight
      );
    });
  }

  return buf;
}

function renderFrostBeacon(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 64);
  const t = (frame / total) * Math.PI * 2;
  const beamSide = Math.cos(t);

  // Layer 0: Glacial ice & marble plinth
  drawGroundPlinth(buf, 28, 56, 20, 5.5, RAMPS.ice, RAMPS.slate);

  // Layer 1: Tapered octagonal ice & marble lighthouse tower
  buf.layer((sub) => {
    drawCylindricalTower(sub, 28, 25, 9, 30, RAMPS.marble, RAMPS.ice);
    drawArchedPortal(sub, 28, 55, 4.5, 10, RAMPS.ice, 'portcullis');
    drawGlowingWindow(sub, 26, 33, 4, 5, RAMPS.cyanMask, RAMPS.ice.deep);
    // Flanking glacier fins
    sub.drawCrystal(15, 53, 10, -1, 0.85, RAMPS.ice);
    sub.drawCrystal(41, 53, 10, 1, 0.25, RAMPS.ice);
  });

  // Layer 2: Upper lookout balcony & sweeping K1/K2 light cone
  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 21, 22, 5, RAMPS.ice, 5);
    drawCrenellations(sub, 17, 19, 22, RAMPS.marble);
  });

  // Layer 3 (Kinetic): Rotating sweeping beacon rays
  const rayLen = Math.round(beamSide * 13);
  if (Math.abs(rayLen) >= 3) {
    buf.layer((ray) => {
      const dir = rayLen > 0 ? 1 : -1;
      for (let d = 4; d <= Math.abs(rayLen); d++) {
        const rx = 28 + dir * d;
        const spread = Math.max(1, Math.floor(d / 4));
        for (let dy = -spread; dy <= spread; dy++) {
          ray.setPixel(
            rx,
            13 + dy,
            Math.abs(dy) === 0 ? '#FFFFFF' : d % 2 === 0 ? RAMPS.cyanMask.highlight : RAMPS.magenta.highlight
          );
        }
      }
    });
  }

  // Layer 4 (Kinetic): Rotating faceted ice prism core & frozen spire crown
  buf.layer((prism) => {
    const hover = Math.round(Math.sin(t * 2) * 1.2);
    for (let dy = -5; dy <= 5; dy++) {
      const hw = Math.max(1, Math.round((1 - Math.abs(dy) / 5.5) * 4));
      for (let dx = -hw; dx <= hw; dx++) {
        const seam = Math.round(beamSide * 2);
        prism.setPixel(
          28 + dx,
          13 + hover + dy,
          dx < seam ? RAMPS.cyanMask.highlight : dx === seam ? '#FFFFFF' : RAMPS.magenta.mid
        );
      }
    }
    drawShingledRoof(prism, 28, 2, 7, 6, RAMPS.ice, RAMPS.gold);
  });

  return buf;
}

function renderDruidTotemMill(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 58);
  const t = (frame / total) * Math.PI * 2;

  // Layer 0: Mossy earth plinth + glowing spring pool
  drawGroundPlinth(buf, 30, 50, 23, 5.5, RAMPS.moss, RAMPS.timber);

  // Layer 1: Moss-covered stone mill house & curved timber roof
  buf.layer((sub) => {
    drawMasonryBox(sub, 10, 26, 23, 24, RAMPS.slate, 4, true);
    drawArchedPortal(sub, 20, 50, 4.5, 9, RAMPS.timber, 'wood');
    drawGlowingWindow(sub, 13, 31, 4, 4, RAMPS.gold, RAMPS.timber.deep);
    // Moss patches on stone wall
    sub.fillEllipse(28, 30, 3, 2, () => RAMPS.moss.mid);
    sub.fillEllipse(12, 43, 2.5, 2, () => RAMPS.moss.highlight);
  });
  drawShingledRoof(buf, 21, 10, 14, 15, RAMPS.moss, RAMPS.magenta, true);

  // Layer 2: Glowing spring trough + splash animation
  buf.layer((pool) => {
    pool.fillEllipse(41, 48, 10, 4, (nx, ny) =>
      Math.sin(t * 2 + nx * 5) > 0.35 ? RAMPS.cyanMask.highlight : RAMPS.ice.mid
    );
  });

  // Layer 3 (Kinetic): Spinning vine-wrapped wooden waterwheel + glowing K2 rune hub
  buf.layer((wheel) => {
    const cx = 41;
    const cy = 34;
    for (let s = 0; s < 8; s++) {
      const a = t + (s * Math.PI * 2) / 8;
      wheel.drawRotatedRect(cx, cy, 11.5, 0.85, a, (u) =>
        u > 0.72 ? RAMPS.moss.highlight : RAMPS.timber.mid
      );
    }
    wheel.fillEllipse(cx, cy, 10.5, 10.5, (nx, ny) => {
      const dist = Math.hypot(nx, ny);
      if (dist >= 0.78 && dist <= 0.96) {
        return ny < 0 ? RAMPS.timber.highlight : RAMPS.timber.shadow;
      }
      return null;
    });
    wheel.fillEllipse(cx, cy, 3.2, 3.2, () => RAMPS.cyanMask.highlight);
    wheel.setPixel(cx, cy, '#FFFFFF');
  });

  // Layer 4 (Kinetic): Twin golden fireflies orbiting the leafy roof
  for (let i = 0; i < 2; i++) {
    const a = t + i * Math.PI;
    const fx = Math.round(22 + Math.cos(a) * 14);
    const fy = Math.round(14 + Math.sin(a * 2) * 3.5);
    buf.layer((fly) => {
      fly.fillRect(fx, fy, 2, 2, RAMPS.gold.highlight);
    });
  }

  return buf;
}

function renderHellfirePortal(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(62, 64);
  const t = (frame / total) * Math.PI * 2;
  const pulse = (Math.sin(t * 2) + 1) * 0.5;

  // Layer 0: Cracked obsidian volcanic altar dais
  drawGroundPlinth(buf, 31, 56, 24, 5.5, RAMPS.obsidian, RAMPS.lava);

  // Layer 1: Monumental stepped basalt archway & giant curved demon horns
  buf.layer((sub) => {
    drawMasonryBox(sub, 12, 22, 10, 33, RAMPS.obsidian, 3, true);
    drawMasonryBox(sub, 40, 22, 10, 33, RAMPS.obsidian, 3, true);
    drawMasonryBox(sub, 14, 15, 34, 8, RAMPS.obsidian, 5, true);
    // Giant curved horns crowning the gateway
    sub.drawRibArch(16, 16, 9, 10, 13, 3, 2, RAMPS.bone);
    sub.drawRibArch(46, 16, 53, 10, 49, 3, 2, RAMPS.bone);
    sub.drawSkull(31, 18, 'medium', RAMPS.lava.highlight, RAMPS.bone);
    // Flanking roaring braziers
    drawBrazier(sub, 16, 51, t, RAMPS.lava);
    drawBrazier(sub, 46, 51, t + Math.PI, RAMPS.lava);
  });

  // Layer 2 (Kinetic): Swirling dimensional molten vortex inside arch (K1 + lava + white core)
  buf.layer((vortex) => {
    vortex.fillEllipse(31, 39, 9.5, 14, (nx, ny) => {
      const dist = Math.hypot(nx, ny);
      const ang = Math.atan2(ny, nx) + dist * 4 - t * 2;
      const swirl = Math.sin(ang * 3);
      if (dist < 0.25) return '#FFFFFF';
      if (dist < 0.48) return pulse > 0.5 ? RAMPS.lava.highlight : RAMPS.cyanMask.highlight;
      if (swirl > 0.2) return RAMPS.magenta.highlight;
      if (swirl > -0.3) return RAMPS.magenta.mid;
      return RAMPS.magenta.deep;
    });
  });

  // Layer 3 (Kinetic): Rising portal sparks inside isolated 1px layer
  for (let s = 0; s < 3; s++) {
    const prog = ((frame / total) + s * 0.33) % 1;
    const sy = Math.round(52 - prog * 28);
    const sx = Math.round(31 + Math.sin(t * 2 + s * 2.1) * 5.5);
    buf.layer((spark) => {
      spark.fillRect(sx, sy, 2, 2, prog > 0.5 ? RAMPS.gold.highlight : RAMPS.lava.highlight);
    });
  }

  return buf;
}

export const ANIMATED_MODELS: PixelModelDef[] = [
  {
    id: 'bone-windmill',
    name: 'Костяная Мельница',
    subtitle: 'Ветряная мельница некрополиса (58×62)',
    kind: 'animated',
    tier: 'II',
    faction: 'Некрополь',
    width: 58,
    height: 62,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–2. Статичная цилиндрическая башня с рёбрами, подъёмником и черепом',
      '3. Конический костяной купол и развевающийся штандарт K1/K2',
      '4. Огромный 4-лопастной сшитый ротор (радиус 19.5 px)',
    ],
    description:
      'Увеличенная башня некрополиса с перевязанными рёберными контрфорсами, мешком на кран-балке, кристалльными друзами и 19.5-пиксельным ротором.',
    renderFrame: renderBoneWindmill,
    codeSnippet: `function renderBoneWindmill(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 62);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 29, 54, 21, 5, RAMPS.sandstone, RAMPS.timber);
  buf.layer((sub) => {
    sub.drawRibArch(12, 52, 9, 41, 18, 32, 2, RAMPS.bone);
    sub.drawRibArch(46, 52, 49, 41, 40, 32, 2, RAMPS.bone);
    drawArchedPortal(sub, 29, 53, 4.5, 8, RAMPS.bone, 'void');
    sub.drawSkull(29, 42, 'medium', RAMPS.magenta.highlight, RAMPS.bone);
  });
  drawWavingBanner(buf, 29, 3, 11, t * 2, RAMPS.magenta, RAMPS.cyanMask);
  buf.layer((blades) => {
    for (let b = 0; b < 4; b++) {
      const angle = t + (b * Math.PI) / 2;
      blades.drawRotatedRect(29, 24, 19.5, 0.95, angle, () => RAMPS.timber.mid);
    }
  });
  return buf;
}`,
  },
  {
    id: 'guild-watermill',
    name: 'Водяная Мельница',
    subtitle: 'Лесопилка на каменном акведуке (60×58)',
    kind: 'animated',
    tier: 'I',
    faction: 'Гильдия',
    width: 60,
    height: 58,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–2. Двухэтажная фахверковая мельница со светящимися окнами',
      '3. Мшистый каменный акведук с живым водопадом и пеной',
      '4–5. 10-лопастное колесо с латунной ступицей и качающийся фонарь',
    ],
    description:
      'Полноразмерная гильдейская водяная мельница с падающим потоком из верхнего жёлоба, 10-лопастным колесом, речной пеной и фонарём под свесом.',
    renderFrame: renderGuildWatermill,
    codeSnippet: `function renderGuildWatermill(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 58);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 30, 50, 23, 5.5, RAMPS.slate, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 32, 22, 17, RAMPS.slate, 4, true);
    drawTimberWall(sub, 8, 20, 24, 12, RAMPS.sandstone, RAMPS.timber);
  });
  drawShingledRoof(buf, 20, 8, 14, 12, RAMPS.magenta, RAMPS.gold);
  buf.layer((wheel) => {
    for (let s = 0; s < 10; s++) {
      wheel.drawRotatedRect(39, 36, 12.5, 0.75, t + (s * Math.PI * 2) / 10, () => RAMPS.timber.mid);
    }
  });
  return buf;
}`,
  },
  {
    id: 'arcane-spire',
    name: 'Магический Шпиль',
    subtitle: 'Октаэдр и 3 рунные сферы (54×64)',
    kind: 'animated',
    tier: 'III',
    faction: 'Цитадель',
    width: 54,
    height: 64,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–2. Цилиндрическое мраморное основание и высокие аркбутаны',
      '3. Крупный парящий октаэдр кристалла (K1_MASK)',
      '4. Три орбитальные сферы K1/K2/Золото',
    ],
    description:
      'Высокая беломраморная башня магов с золотыми арками и крупным левитирующим октаэдральным кристаллом, окружённым тремя орбитальными сферами.',
    renderFrame: renderArcaneSpire,
    codeSnippet: `function renderArcaneSpire(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(54, 64);
  const t = (frame / total) * Math.PI * 2;
  const hoverY = Math.round(Math.sin(t) * 2.5);
  drawGroundPlinth(buf, 27, 56, 18, 5, RAMPS.marble, RAMPS.gold);
  buf.layer((sub) => {
    drawCylindricalTower(sub, 27, 36, 11, 19, RAMPS.marble, RAMPS.gold);
    sub.drawRibArch(15, 38, 11, 20, 20, 14, 2, RAMPS.marble);
    sub.drawRibArch(39, 38, 43, 20, 34, 14, 2, RAMPS.marble);
  });
  buf.layer((crystal) => {
    for (let dy = -9; dy <= 9; dy++) {
      const hw = Math.max(0, Math.round((1 - Math.abs(dy) / 9.5) * 6));
      for (let dx = -hw; dx <= hw; dx++) {
        crystal.setPixel(27 + dx, 22 + hoverY + dy, dx < 0 ? RAMPS.magenta.highlight : RAMPS.magenta.mid);
      }
    }
  });
  return buf;
}`,
  },
  {
    id: 'infernal-forge',
    name: 'Паровая Кузня',
    subtitle: 'Рогатая домна, меха и молот (60×58)',
    kind: 'animated',
    tier: 'II',
    faction: 'Кузня Пекла',
    width: 60,
    height: 58,
    frameCount: 12,
    defaultFps: 10,
    layersSpec: [
      '0. Базальтовый цоколь с жилами магмы',
      '1. Дышащие кожаные меха нагнетания воздуха',
      '2–3. Рогатая печь с бушующим огнём и искрами из трубы',
      '4. Механический молот, наковальня и вспышка искр при ударе',
    ],
    description:
      'Синхронизированный кузнечный узел 60×58: дыхание мехов раздувает пламя в рогатой домне, а рычажный молот бьёт по раскалённому слитку.',
    renderFrame: renderInfernalForge,
    codeSnippet: `function renderInfernalForge(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 58);
  const t = (frame / total) * Math.PI * 2;
  const breath = (Math.sin(t) + 1) * 0.5;
  drawGroundPlinth(buf, 30, 50, 22, 5.5, RAMPS.obsidian, RAMPS.lava);
  buf.layer((sub) => {
    drawMasonryBox(sub, 19, 23, 19, 26, RAMPS.obsidian, 4, true);
    sub.drawRibArch(20, 23, 16, 15, 23, 12, 2, RAMPS.bone);
    sub.drawRibArch(37, 23, 41, 15, 34, 12, 2, RAMPS.bone);
    drawArchedPortal(sub, 28, 49, 5, 10, RAMPS.gold, 'void');
    drawAnimatedFlame(sub, 28, 48, 4, 6 + Math.round(breath * 3), t, RAMPS.lava);
  });
  return buf;
}`,
  },
  {
    id: 'guild-clocktower',
    name: 'Хронометр Гильдии',
    subtitle: 'Тройной редуктор и маятник (56×64)',
    kind: 'animated',
    tier: 'III',
    faction: 'Гильдия',
    width: 56,
    height: 64,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–1. Песчаниковая галерея с двумя жаровнями',
      '2. Размашистый латунный маятник в арке',
      '3–4. Три сцепленные латунные шестерни (10:8:6)',
      '5. Вогнутая крыша и сканирующий телескоп',
    ],
    description:
      'Часовая обсерватория повышенной детализации с тройной передачей зубчатых колёс (10:8:6), качающимся маятником и поворотной трубой.',
    renderFrame: renderGuildClocktower,
    codeSnippet: `function renderGuildClocktower(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 64);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 28, 56, 19, 5, RAMPS.sandstone, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 15, 18, 26, 22, RAMPS.sandstone, 5, true);
  });
  drawClockworkGear(buf, 23, 28, 4.5, 10, t, RAMPS.gold, RAMPS.magenta.highlight);
  drawClockworkGear(buf, 32, 32, 3.3, 8, -t * 1.25, RAMPS.gold, RAMPS.cyanMask.highlight);
  drawClockworkGear(buf, 33, 23, 2.5, 6, t * 1.667, RAMPS.gold, RAMPS.magenta.mid);
  drawShingledRoof(buf, 28, 7, 15, 11, RAMPS.magenta, RAMPS.gold, true);
  return buf;
}`,
  },
  {
    id: 'sky-galleon-dock',
    name: 'Небесная Верфь',
    subtitle: 'Причальный кран и дирижабль (64×62)',
    kind: 'animated',
    tier: 'III',
    faction: 'Некрополь',
    width: 64,
    height: 62,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–1. Каменно-фахверковый пирс с краном и фонарём',
      '2. Рёберный дирижабль с масками K1/K2, иллюминаторами и винтом',
      '3. Развевающийся вымпел на баллоне',
    ],
    description:
      'Крупный причальный узел 64×62: кран с качающимся фонарём удерживает у пирса полосатый дирижабль с костяной гондолой и вращающимся винтом.',
    renderFrame: renderSkyGalleonDock,
    codeSnippet: `function renderSkyGalleonDock(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(64, 62);
  const t = (frame / total) * Math.PI * 2;
  const bob = Math.round(Math.sin(t) * 1.8);
  drawGroundPlinth(buf, 32, 54, 24, 5.5, RAMPS.sandstone, RAMPS.timber);
  buf.layer((ship) => {
    ship.fillEllipse(40, 17 + bob, 16, 8, (nx, ny, px) =>
      px % 6 === 0 ? RAMPS.magenta.mid : RAMPS.sail.mid
    );
    ship.fillEllipse(40, 36 + bob, 14, 5, () => RAMPS.timber.mid);
    ship.drawSkull(26, 34 + bob, 'mini', RAMPS.magenta.highlight, RAMPS.bone);
  });
  return buf;
}`,
  },
  {
    id: 'titan-foundry',
    name: 'Литейная Титанов',
    subtitle: 'Разливочный тигель с потоком лавы (60×60)',
    kind: 'animated',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 60,
    height: 60,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–1. Базальтовая платформа, горн и мостовой кран',
      '2. Шестерня привода лебёдки',
      '3. Подвесной тигель, льющий непрерывный поток лавы в форму',
      '4. Клубы белого пара, поднимающиеся от изложницы',
    ],
    description:
      'Новая кинетическая модель 60×60: поворотный мостовой тигель изливает струю жидкого металла в напольную форму, поднимая клубы светлого пара.',
    renderFrame: renderTitanFoundry,
    codeSnippet: `function renderTitanFoundry(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 60);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 30, 52, 22, 5.5, RAMPS.obsidian, RAMPS.lava);
  buf.layer((sub) => {
    drawMasonryBox(sub, 10, 22, 16, 29, RAMPS.slate, 4, true);
    sub.fillRect(14, 15, 31, 4, RAMPS.slate.mid);
  });
  drawClockworkGear(buf, 18, 17, 4, 8, t, RAMPS.gold, RAMPS.magenta.highlight);
  buf.layer((pour) => {
    pour.fillEllipse(31, 26, 6, 5, () => RAMPS.slate.mid);
    for (let y = 29; y <= 46; y++) pour.setPixel(32, y, RAMPS.lava.highlight);
  });
  return buf;
}`,
  },
  {
    id: 'summoning-obelisk',
    name: 'Обелиск Призыва',
    subtitle: 'Левитирующий монолит с лучом (56×62)',
    kind: 'animated',
    tier: 'II',
    faction: 'Некрополь',
    width: 56,
    height: 62,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–1. Магический рунный круг и фланговые пилоны с жаровнями',
      '2. Разломленный обсидиановый обелиск на вертикальном луче K1',
      '3. Две орбитальные сферы K2, вращающиеся вокруг монолита',
    ],
    description:
      'Новый анимированный алтарь 56×62: расколотый обсидиановый монолит парит над рунным кругом в потоке восходящей энергии масок K1 и K2.',
    renderFrame: renderSummoningObelisk,
    codeSnippet: `function renderSummoningObelisk(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 62);
  const t = (frame / total) * Math.PI * 2;
  const hover = Math.round(Math.sin(t) * 2.5);
  drawGroundPlinth(buf, 28, 54, 21, 5.5, RAMPS.slate, RAMPS.obsidian);
  buf.layer((obelisk) => {
    for (let y = 14; y <= 50; y++) obelisk.setPixel(28, y, RAMPS.magenta.mid);
    for (let dy = 0; dy < 22; dy++) {
      const hw = Math.max(1, Math.round(1 + (dy / 21) * 5.5));
      for (let dx = -hw; dx <= hw; dx++) {
        obelisk.setPixel(28 + dx, 10 + hover + dy, RAMPS.obsidian.mid);
      }
    }
  });
  return buf;
}`,
  },
  {
    id: 'alchemist-lab',
    name: 'Лаборатория Алхимика',
    subtitle: 'Кипящий чан с пузырями и паром (58×60)',
    kind: 'animated',
    tier: 'I',
    faction: 'Гильдия',
    width: 58,
    height: 60,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–1. Аптекарская пристройка с перегонной медной трубой',
      '2. Топка с живым огнём под стеклянным чаном',
      '3. Светящийся эликсир K1 с поднимающимися пузырями K2',
      '4. Клубы пара над горловиной реторты',
    ],
    description:
      'Кинетическая постройка уровня I: в огромном перегонном чане кипит зелье (K1), всплывают пузыри (K2), полыхает горелка и поднимается пар.',
    renderFrame: renderAlchemistLab,
    codeSnippet: `function renderAlchemistLab(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 60);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 29, 52, 22, 5.5, RAMPS.slate, RAMPS.timber);
  buf.layer((vat) => {
    vat.fillEllipse(40, 31, 8.5, 10, () => RAMPS.magenta.mid);
    for (let b = 0; b < 3; b++) {
      const prog = ((frame / total) + b * 0.33) % 1;
      vat.fillRect(37 + b * 3, Math.round(37 - prog * 13), 2, 2, RAMPS.cyanMask.highlight);
    }
  });
  return buf;
}`,
  },
  {
    id: 'frost-beacon',
    name: 'Ледяной Маяк',
    subtitle: 'Вращающаяся призма с лучами (56×64)',
    kind: 'animated',
    tier: 'II',
    faction: 'Бастион Мороза',
    width: 56,
    height: 64,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–1. Мраморно-ледяная башня с кристаллами у основания',
      '2. Зубчатая площадка маяка',
      '3. Вращающиеся призматические лучи (K1 + K2)',
      '4. Левитирующий кристалл в центре фонаря',
    ],
    description:
      'Постройка уровня II: вращающаяся призма прорезает пространство импульсными лучами масок K1/K2 на вершине ледяного маяка.',
    renderFrame: renderFrostBeacon,
    codeSnippet: `function renderFrostBeacon(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 64);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 28, 56, 20, 5.5, RAMPS.ice, RAMPS.slate);
  buf.layer((sub) => drawCylindricalTower(sub, 28, 25, 9, 30, RAMPS.marble, RAMPS.ice));
  buf.layer((prism) => {
    prism.fillRect(26, 10, 5, 6, Math.cos(t) > 0 ? RAMPS.cyanMask.highlight : RAMPS.magenta.mid);
  });
  return buf;
}`,
  },
  {
    id: 'druid-totem-mill',
    name: 'Роща Жерновов',
    subtitle: 'Лесная мельница и светляки (60×58)',
    kind: 'animated',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 60,
    height: 58,
    frameCount: 16,
    defaultFps: 10,
    layersSpec: [
      '0–1. Мшистый каменный дом с лиственной крышей (K1)',
      '2. Бирюзовый источник с бегущей рябью',
      '3. Вращающееся деревянное колесо с порослью мха и ступицей K2',
      '4. Два золотых светляка, кружащих над кроной',
    ],
    description:
      'Постройка уровня II для Лесного Круга: увитое лианами колесо вращается в рунном источнике под полёт золотых светляков.',
    renderFrame: renderDruidTotemMill,
    codeSnippet: `function renderDruidTotemMill(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 58);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 30, 50, 23, 5.5, RAMPS.moss, RAMPS.timber);
  buf.layer((wheel) => {
    for (let s = 0; s < 8; s++) {
      wheel.drawRotatedRect(41, 34, 11.5, 0.85, t + (s * Math.PI * 2) / 8, () => RAMPS.timber.mid);
    }
  });
  return buf;
}`,
  },
  {
    id: 'hellfire-portal',
    name: 'Врата Инферно',
    subtitle: 'Рогатый алтарь с вихрем (62×64)',
    kind: 'animated',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 62,
    height: 64,
    frameCount: 16,
    defaultFps: 12,
    layersSpec: [
      '0–1. Базальтовая арка с гигантскими рогами, черепом и жаровнями',
      '2. Спиральный пространственный вихрь K1 с раскалённым ядром',
      '3. Восходящие огненные искры перед порталом',
    ],
    description:
      'Элитная анимированная постройка уровня III: массивные рогатые врата обрамляют вращающийся вихрь энергии (K1/K2) и поток искр.',
    renderFrame: renderHellfirePortal,
    codeSnippet: `function renderHellfirePortal(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(62, 64);
  const t = (frame / total) * Math.PI * 2;
  drawGroundPlinth(buf, 31, 56, 24, 5.5, RAMPS.obsidian, RAMPS.lava);
  buf.layer((vortex) => {
    vortex.fillEllipse(31, 39, 9.5, 14, (nx, ny) => {
      const dist = Math.hypot(nx, ny);
      return dist < 0.25 ? '#FFFFFF' : Math.sin(Math.atan2(ny, nx) * 3 - t * 2) > 0 ? RAMPS.magenta.highlight : RAMPS.magenta.mid;
    });
  });
  return buf;
}`,
  },
];
