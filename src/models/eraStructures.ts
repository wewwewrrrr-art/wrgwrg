import {
  VOID,
  drawArchedPortal,
  drawBrazier,
  drawCrenellations,
  drawCylindricalTower,
  drawGlowingWindow,
  drawGroundPlinth,
  drawMasonryBox,
  drawShingledRoof,
  drawSwingingLantern,
  drawTimberWall,
} from '../engine/architectureGrammar';
import { applyBuildingState } from '../engine/buildingStates';
import { RAMPS, WATER_LINE } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { drawCurvedHorn, pickTopLeftTone } from './eraCreatureHelpers';
import {
  BuildingFunction,
  BuildingState,
  EraId,
  FactionName,
  ModelKind,
  ModelTier,
  PixelModelDef,
  RenderContextOptions,
} from './types';

function drawSmokePlume(
  buf: PixelBuffer,
  x: number,
  y: number,
  frame: number,
  total: number,
  color = '#C4CDD9'
): void {
  const p = frame / Math.max(1, total);
  const drift = Math.sin(p * Math.PI * 2) * 1.4;
  const fadeTone = color.length === 7 ? '#838D9C' : color;
  for (let i = 0; i < 4; i++) {
    const u = (p * (1 + i * 0.08) + i * 0.21) % 1;
    const sx = Math.round(x + Math.sin(u * Math.PI * 2 + p * Math.PI * 2) * 1.8 + drift * u);
    const sy = Math.max(2, Math.round(y - u * 10 - (frame % 2) * 0.5));
    const r = u < 0.35 ? 1.5 : u < 0.7 ? 1.2 : 1.0;
    buf.fillEllipse(sx, sy, r, r, u > 0.65 ? fadeTone : color);
  }
}

function drawCampfireFlames(buf: PixelBuffer, cx: number, cy: number, frame: number): void {
  const t = (frame / 12) * Math.PI * 2;
  const sway = Math.round(Math.sin(t) * 1.3);
  const lift = Math.round((Math.cos(t * 2) + 1) * 1.1);
  buf.fillEllipse(cx, cy, 4.3, 2.4, RAMPS.lava.shadow);
  buf.fillEllipse(cx + sway * 0.5, cy - 2, 2.9, 3.0 + lift * 0.35, RAMPS.lava.mid);
  buf.fillEllipse(cx - sway * 0.4, cy - 3 - lift * 0.4, 1.9, 2.5, RAMPS.gold.mid);
  buf.setPixel(cx + sway, Math.max(2, cy - 5 - lift), RAMPS.gold.highlight);
  const sparkY = Math.max(2, cy - 4 - (frame % 7));
  const sparkX = cx + Math.round(Math.sin(t * 2 + 1) * 2.2);
  buf.setPixel(sparkX, sparkY, RAMPS.lava.highlight);
}

function drawWavingBanner(
  buf: PixelBuffer,
  poleX: number,
  topY: number,
  frame: number,
  total: number,
  width = 7,
  height = 4
): void {
  buf.drawLine(poleX, topY, poleX, topY + height + 5, RAMPS.timber.mid, 1);
  buf.setPixel(poleX, topY - 1, RAMPS.gold.highlight);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  for (let dx = 1; dx <= width; dx++) {
    const wave = Math.round(Math.sin(t - dx * 0.65) * 0.8);
    for (let dy = 0; dy < height; dy++) {
      const c =
        dy === 0
          ? RAMPS.magenta.highlight
          : dy === Math.floor(height / 2) && dx <= 4
            ? RAMPS.cyanMask.highlight
            : dx > width - 2
              ? RAMPS.magenta.deep
              : RAMPS.magenta.mid;
      buf.setPixel(poleX + dx, topY + dy + wave, c);
    }
  }
}

function withState(
  renderReady: (frame: number, total: number) => PixelBuffer
): (frame: number, total: number, ctx?: RenderContextOptions) => PixelBuffer {
  return (frame, total, ctx) => {
    const state: BuildingState = ctx?.buildingState ?? 'ready';
    const ready = renderReady(frame, total);
    return applyBuildingState(ready, state, frame, total);
  };
}

function makeBuildingDef(cfg: {
  id: string;
  name: string;
  subtitle: string;
  era: EraId;
  buildingFunction: BuildingFunction;
  kind: ModelKind;
  tier: ModelTier;
  faction: FactionName;
  width: number;
  height: number;
  frameCount: number;
  layersSpec: string[];
  description: string;
  renderReady: (frame: number, total: number) => PixelBuffer;
}): PixelModelDef {
  return {
    id: cfg.id,
    name: cfg.name,
    subtitle: cfg.subtitle,
    kind: cfg.kind,
    tier: cfg.tier,
    era: cfg.era,
    entityType: 'building',
    buildingFunction: cfg.buildingFunction,
    supportsBuildingStates: true,
    faction: cfg.faction,
    width: cfg.width,
    height: cfg.height,
    frameCount: cfg.frameCount,
    defaultFps: cfg.frameCount > 1 ? 8 : 1,
    layersSpec: cfg.layersSpec,
    description: cfg.description,
    renderFrame: withState(cfg.renderReady),
    codeSnippet: `// Procedural ${cfg.era} ${cfg.buildingFunction} structure: ${cfg.id}`,
  };
}

// ============================================================================
// ЛЕДНИКОВЬЕ И МЕГАФАУНА — ЛАГЕРЯ И СТОЯНКИ (3)
// ============================================================================

function renderIceCampfire(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(48, 42);
  drawGroundPlinth(buf, 24, 34, 19, 5.2, RAMPS.birch, RAMPS.slate);
  // Snow-dusted stone hearth ring + stacked timber roasting spit
  buf.layer((sub) => {
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const sx = Math.round(24 + Math.cos(ang) * 9);
      const sy = Math.round(31 + Math.sin(ang) * 3.2);
      sub.fillEllipse(sx, sy, 2.3, 1.9, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    }
    // Crossed logs & meat rack with K1 tribal wrapping
    sub.drawLine(14, 33, 19, 17, RAMPS.timber.mid, 2);
    sub.drawLine(34, 33, 29, 17, RAMPS.timber.shadow, 2);
    sub.drawLine(16, 20, 32, 20, RAMPS.timber.highlight, 1);
    sub.fillEllipse(24, 21, 3.5, 2.0, RAMPS.autumn.mid);
    sub.fillRect(18, 19, 2, 2, RAMPS.magenta.mid);
    sub.fillRect(29, 19, 2, 2, RAMPS.cyanMask.mid);
    // Rolled mammoth hide bundle on left
    sub.fillEllipse(10, 31, 4.2, 2.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.sandstone));
  });
  drawCampfireFlames(buf, 24, 29, frame);
  drawSmokePlume(buf, 24, 15, frame, total, '#DCE5EDAA');
  return buf;
}

function renderIceHideShelter(): PixelBuffer {
  const buf = new PixelBuffer(54, 46);
  drawGroundPlinth(buf, 27, 38, 22, 5.5, RAMPS.birch, RAMPS.slate);
  // Rear timber frame & bundled firewood
  buf.layer((sub) => {
    sub.drawLine(12, 36, 24, 11, RAMPS.timber.mid, 2);
    sub.drawLine(42, 36, 30, 11, RAMPS.timber.shadow, 2);
    sub.fillRect(10, 32, 6, 4, RAMPS.timber.mid);
  });
  // Draped stitched mammoth hides + K1 tribal clan glyph
  buf.layer((sub) => {
    for (let y = 13; y <= 37; y++) {
      const u = (y - 13) / 24;
      const hw = Math.round(4 + u * 15);
      for (let dx = -hw; dx <= hw; dx++) {
        const stitch = (dx + y * 2) % 7 === 0;
        const c =
          dx < -hw * 0.3
            ? RAMPS.sandstone.highlight
            : dx > hw * 0.32
              ? RAMPS.timber.deep
              : stitch
                ? RAMPS.timber.shadow
                : RAMPS.sandstone.mid;
        sub.setPixel(27 + dx, y, c);
      }
    }
    // Dark shelter entry cavity & fur rug
    sub.fillEllipse(27, 33, 6.2, 5.5, VOID);
    sub.fillEllipse(27, 37, 7, 2.2, RAMPS.bone.mid);
    // K1/K2 painted mammoth totem emblem above doorway
    sub.fillRect(24, 19, 6, 3, RAMPS.magenta.mid);
    sub.fillRect(26, 18, 2, 2, RAMPS.cyanMask.highlight);
    // Antler trophy crowning ridge pole
    drawCurvedHorn(sub, 25, 13, 19, 6, 21, 9, 1.3, RAMPS.bone);
    drawCurvedHorn(sub, 29, 13, 35, 6, 33, 9, 1.3, RAMPS.bone);
  });
  return buf;
}

function renderIceMammothHut(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 52);
  drawGroundPlinth(buf, 29, 44, 24, 5.8, RAMPS.birch, RAMPS.slate);
  // Domed hide & turf hut body
  buf.layer((sub) => {
    sub.fillEllipse(29, 32, 18, 12, (nx, ny, px, py) => {
      if (ny > 0.55) return RAMPS.timber.deep;
      const seam = (px * 3 + py * 2) % 9 === 0;
      if (seam) return RAMPS.timber.shadow;
      return pickTopLeftTone(nx, ny, RAMPS.sandstone);
    });
    // Snow cap & smoke vent hole
    sub.fillEllipse(29, 21, 9, 3.2, RAMPS.birch.highlight);
    sub.fillEllipse(29, 20, 3, 1.2, VOID);
  });
  // Giant twin arched mammoth tusks framing the bone-dome & portal
  buf.layer((sub) => {
    drawCurvedHorn(sub, 12, 42, 23, 14, 11, 22, 2.6, RAMPS.bone);
    drawCurvedHorn(sub, 46, 42, 35, 14, 47, 22, 2.6, RAMPS.bone);
    drawArchedPortal(sub, 29, 43, 5, 9, RAMPS.bone, 'void');
    // Warm hearth glow deep inside doorway
    sub.fillEllipse(29, 41, 2.5, 2.0, RAMPS.lava.mid);
    sub.setPixel(29, 41, RAMPS.gold.highlight);
  });
  drawWavingBanner(buf, 41, 14, frame, total, 6, 3);
  drawSmokePlume(buf, 29, 18, frame, total, '#E2EBF2AA');
  return buf;
}

// ============================================================================
// КАМЕННЫЙ ВЕК (10)
// ============================================================================

function renderStoneWigwam(): PixelBuffer {
  const buf = new PixelBuffer(52, 48);
  drawGroundPlinth(buf, 26, 40, 20, 5.2, RAMPS.sandstone, RAMPS.moss);
  // Exposed protruding birch/timber pole tips at cone peak
  buf.layer((sub) => {
    sub.drawLine(23, 13, 29, 6, RAMPS.timber.highlight, 1);
    sub.drawLine(29, 13, 23, 6, RAMPS.timber.mid, 1);
    sub.drawLine(26, 13, 26, 5, RAMPS.timber.shadow, 1);
  });
  // Conical woven brushwood & bark teepee/wigwam body
  buf.layer((sub) => {
    for (let y = 11; y <= 39; y++) {
      const u = (y - 11) / 28;
      const hw = Math.round(3 + u * 15);
      for (let dx = -hw; dx <= hw; dx++) {
        const barkLine = (dx * 2 + Math.floor(y / 2)) % 5 === 0;
        const c =
          dx < -hw * 0.3
            ? RAMPS.timber.highlight
            : dx > hw * 0.35
              ? RAMPS.timber.deep
              : barkLine
                ? RAMPS.sandstone.shadow
                : RAMPS.timber.mid;
        sub.setPixel(26 + dx, y, c);
      }
    }
    // K1 woven tribal band around middle
    sub.fillRect(16, 26, 20, 2, RAMPS.magenta.mid);
    sub.fillRect(18, 26, 6, 1, RAMPS.cyanMask.highlight);
    // Arched entry opening
    sub.fillEllipse(26, 35, 4.5, 5.0, VOID);
    // Decorative skull charm above entry
    sub.drawSkull(26, 29, 'mini', RAMPS.magenta.highlight, RAMPS.bone);
  });
  return buf;
}

function renderStoneDugout(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(54, 46);
  drawGroundPlinth(buf, 27, 38, 22, 5.5, RAMPS.sandstone, RAMPS.timber);
  // Earthen turf-mound shelter walls & mossy grassy mound roof
  buf.layer((sub) => {
    sub.fillEllipse(27, 29, 19, 10.5, (nx, ny, px, py) => {
      if (ny > 0.35) return pickTopLeftTone(nx, ny, RAMPS.timber);
      const tuft = (px * 5 + py * 3) % 7 === 0;
      if (tuft) return RAMPS.moss.highlight;
      return pickTopLeftTone(nx, ny, RAMPS.moss);
    });
    // Timber log doorway lintel & recessed cave entry
    sub.fillRect(20, 29, 14, 10, RAMPS.timber.mid);
    sub.fillRect(20, 29, 10, 2, RAMPS.timber.highlight);
    sub.fillRect(31, 29, 3, 10, RAMPS.timber.deep);
    sub.fillRect(23, 32, 8, 7, VOID);
    sub.fillEllipse(27, 37, 2, 1.5, RAMPS.lava.mid);
    // K1 clan banner post beside door
    sub.fillRect(16, 24, 2, 13, RAMPS.timber.mid);
    sub.fillRect(13, 25, 4, 5, RAMPS.magenta.mid);
    sub.fillRect(14, 26, 2, 2, RAMPS.cyanMask.highlight);
  });
  // Clay chimney pipe emitting slow smoke
  buf.fillRect(34, 17, 4, 5, RAMPS.sandstone.mid);
  buf.fillRect(34, 17, 2, 5, RAMPS.sandstone.highlight);
  drawSmokePlume(buf, 36, 15, frame, total);
  return buf;
}

function renderStoneHearthPit(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(50, 42);
  drawGroundPlinth(buf, 25, 34, 20, 5.2, RAMPS.sandstone, RAMPS.timber);
  // Cobble stone fire ring + wooden tripod + hanging blackened cooking pot
  buf.layer((sub) => {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      sub.fillEllipse(
        Math.round(25 + Math.cos(a) * 10),
        Math.round(31 + Math.sin(a) * 3.5),
        2.6,
        2.0,
        (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate)
      );
    }
    sub.drawLine(14, 34, 25, 12, RAMPS.timber.mid, 2);
    sub.drawLine(36, 34, 25, 12, RAMPS.timber.shadow, 2);
    sub.drawLine(25, 12, 25, 21, RAMPS.slate.mid, 1);
    // Hanging stone/clay cauldron
    sub.fillEllipse(25, 23, 4.2, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.obsidian));
    // K1 totem pennant tied to tripod apex
    sub.fillRect(25, 11, 5, 3, RAMPS.magenta.mid);
    sub.fillRect(26, 12, 2, 1, RAMPS.cyanMask.highlight);
    // Stacked firewood pile right
    sub.fillEllipse(37, 32, 4, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
  });
  drawCampfireFlames(buf, 25, 31, frame);
  drawSmokePlume(buf, 25, 11, frame, total, '#C4CAD699');
  return buf;
}

function renderStoneTotemPole(): PixelBuffer {
  const buf = new PixelBuffer(46, 58);
  drawGroundPlinth(buf, 23, 50, 17, 4.8, RAMPS.moss, RAMPS.slate);
  // Stone base collar + tall carved cedar totem column + outstretched thunderbird wings
  buf.layer((sub) => {
    for (let dx = -9; dx <= 9; dx += 4) {
      sub.fillEllipse(23 + dx, 48, 3, 2.4, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    }
    drawMasonryBox(sub, 18, 12, 10, 36, RAMPS.timber, 3, false);
    // Outstretched thunderbird plank wings at top
    sub.fillRect(7, 15, 32, 4, RAMPS.timber.mid);
    sub.fillRect(7, 15, 22, 1, RAMPS.timber.highlight);
    sub.fillRect(9, 17, 6, 2, RAMPS.magenta.mid);
    sub.fillRect(31, 17, 6, 2, RAMPS.magenta.shadow);
    // 3 stacked carved tribal spirit faces with K1/K2 pigment inlays
    for (const fy of [16, 27, 38]) {
      sub.fillRect(19, fy, 3, 2, RAMPS.cyanMask.highlight);
      sub.fillRect(24, fy, 3, 2, RAMPS.cyanMask.highlight);
      sub.fillRect(20, fy + 3, 6, 2, RAMPS.magenta.highlight);
      sub.fillRect(21, fy + 4, 4, 1, VOID);
    }
    // Crown crest feathers
    sub.drawLine(21, 12, 19, 6, RAMPS.bone.highlight, 1);
    sub.drawLine(23, 12, 23, 5, RAMPS.magenta.highlight, 2);
    sub.drawLine(25, 12, 27, 6, RAMPS.bone.mid, 1);
  });
  return buf;
}

function renderStoneMenhir(): PixelBuffer {
  const buf = new PixelBuffer(48, 56);
  drawGroundPlinth(buf, 24, 48, 18, 5.0, RAMPS.moss, RAMPS.slate);
  // Leaning rough-hewn granite menhir monolith + carved spiral petroglyph + offering stones
  buf.layer((sub) => {
    for (let y = 9; y <= 46; y++) {
      const u = (y - 9) / 37;
      const hw = Math.round(4 + Math.sin(u * Math.PI * 0.8) * 5 + u * 2);
      const shiftX = Math.round((1 - u) * -1);
      for (let dx = -hw; dx <= hw; dx++) {
        const crack = (dx * 3 + y * 5) % 13 === 0;
        const c =
          y > 41 && (dx + y) % 3 === 0
            ? RAMPS.moss.mid
            : dx < -hw * 0.35
              ? RAMPS.marble.mid
              : dx > hw * 0.35
                ? RAMPS.slate.deep
                : crack
                  ? RAMPS.slate.shadow
                  : RAMPS.slate.mid;
        sub.setPixel(24 + dx + shiftX, y, c);
      }
    }
    // Carved glowing K1/K2 spiral & sun runes
    sub.fillEllipse(24, 22, 3.2, 3.2, RAMPS.magenta.mid);
    sub.fillEllipse(24, 22, 1.5, 1.5, RAMPS.cyanMask.highlight);
    sub.drawLine(24, 27, 24, 36, RAMPS.cyanMask.mid, 1);
    sub.drawLine(21, 31, 27, 31, RAMPS.magenta.highlight, 1);
    // Flanking mossy altar boulders
    sub.fillEllipse(13, 45, 3.5, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    sub.fillEllipse(35, 45, 3.5, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
  });
  return buf;
}

function renderStoneCircle(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 52);
  drawGroundPlinth(buf, 30, 42, 25, 7.0, RAMPS.moss, RAMPS.sandstone);
  const pulse = Math.sin((frame / Math.max(1, total)) * Math.PI * 2);

  // Back trilithon megalith arches (stonehenge ring)
  buf.layer((sub) => {
    for (const ax of [13, 25, 37]) {
      drawMasonryBox(sub, ax, 16, 4, 18, RAMPS.slate, 1, false);
      drawMasonryBox(sub, ax + 6, 16, 4, 18, RAMPS.slate, 1, false);
      drawMasonryBox(sub, ax - 1, 13, 12, 4, RAMPS.marble, 3, false);
    }
  });
  // Central solstice altar stone + K1/K2 pulsing ley crystal + foreground standing stones
  buf.layer((sub) => {
    drawMasonryBox(sub, 25, 33, 10, 6, RAMPS.marble, 3, false);
    sub.fillEllipse(30, 32, 3.0, 2.0, pulse > 0 ? RAMPS.cyanMask.highlight : RAMPS.magenta.highlight);
    drawMasonryBox(sub, 9, 29, 4, 13, RAMPS.slate, 1, false);
    drawMasonryBox(sub, 47, 29, 4, 13, RAMPS.slate, 1, false);
    // Floating spirit orb above altar
    const orbY = Math.round(25 + pulse * 1.8);
    sub.fillEllipse(30, orbY, 2.2, 2.2, RAMPS.magenta.highlight);
    sub.setPixel(30, orbY, '#FFFFFF');
  });
  return buf;
}

function renderStonePalisade(): PixelBuffer {
  const buf = new PixelBuffer(56, 46);
  drawGroundPlinth(buf, 28, 39, 24, 5.2, RAMPS.sandstone, RAMPS.timber);
  // Row of 11 sharpened timber logs lashed by crossbeams + raised walkway + K1 war shield
  buf.layer((sub) => {
    for (let i = 0; i < 11; i++) {
      const lx = 7 + i * 4;
      const topY = i >= 4 && i <= 6 ? 19 : 14 + (i % 2);
      sub.fillRect(lx, topY, 4, 38 - topY, i > 7 ? RAMPS.timber.shadow : RAMPS.timber.mid);
      sub.fillRect(lx, topY, 1, 38 - topY, RAMPS.timber.highlight);
      sub.fillRect(lx + 3, topY, 1, 38 - topY, RAMPS.timber.deep);
      // Sharpened log tip
      sub.fillRect(lx + 1, topY - 2, 2, 2, RAMPS.sandstone.highlight);
    }
    // Lashed horizontal bracing & fighting plank platform
    sub.fillRect(6, 25, 44, 3, RAMPS.timber.shadow);
    sub.fillRect(6, 25, 40, 1, RAMPS.timber.highlight);
    sub.fillRect(6, 34, 44, 2, RAMPS.timber.deep);
    // Double center timber gate doors with K1/K2 painted totem shields
    sub.fillRect(23, 24, 10, 14, RAMPS.timber.deep);
    sub.fillEllipse(20, 29, 3.0, 3.0, RAMPS.magenta.mid);
    sub.setPixel(20, 29, RAMPS.cyanMask.highlight);
    sub.fillEllipse(36, 29, 3.0, 3.0, RAMPS.magenta.mid);
    sub.setPixel(36, 29, RAMPS.cyanMask.highlight);
  });
  return buf;
}

function renderStoneAnimalPen(): PixelBuffer {
  const buf = new PixelBuffer(56, 46);
  drawGroundPlinth(buf, 28, 38, 24, 5.5, RAMPS.timber, RAMPS.sandstone);
  // Back wattle branch fence, haystacks & wooden feeding trough
  buf.layer((sub) => {
    for (const px of [9, 18, 28, 38, 47]) {
      sub.fillRect(px, 21, 2, 16, RAMPS.timber.mid);
      sub.fillRect(px, 21, 1, 16, RAMPS.timber.highlight);
    }
    sub.fillRect(9, 24, 39, 2, RAMPS.timber.highlight);
    sub.fillRect(9, 29, 39, 2, RAMPS.timber.shadow);
    // Golden haystack & stone water trough
    sub.fillEllipse(16, 33, 5.2, 4.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.gold));
    sub.fillRect(30, 32, 11, 4, RAMPS.timber.shadow);
    sub.fillRect(31, 32, 9, 2, RAMPS.ice.mid);
    // Front low gate & K1 clan ribbon on fence post
    sub.fillRect(8, 36, 40, 2, RAMPS.timber.mid);
    sub.fillRect(8, 36, 30, 1, RAMPS.timber.highlight);
    sub.fillRect(47, 22, 3, 5, RAMPS.magenta.mid);
    sub.setPixel(48, 23, RAMPS.cyanMask.highlight);
  });
  return buf;
}

function renderStoneCaveDwelling(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 50);
  drawGroundPlinth(buf, 29, 43, 24, 5.5, RAMPS.sandstone, RAMPS.slate);
  // Craggy layered cliff overhang arching over cavernous hollow
  buf.layer((sub) => {
    sub.fillEllipse(29, 27, 22, 16, (nx, ny, px, py) => {
      const strata = py % 4 === 0;
      if (strata && ny < 0.2) return RAMPS.slate.shadow;
      return pickTopLeftTone(nx, ny, RAMPS.slate);
    });
    // Mossy turf crown along top of limestone cliff
    sub.fillEllipse(25, 13, 14, 3.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.moss));
    // Recessed cave mouth + warm flickering hearth inside
    sub.fillEllipse(28, 34, 10, 9, VOID);
    const flicker = frame % 2;
    sub.fillEllipse(27, 39, 4.5, 2.5, RAMPS.lava.shadow);
    sub.fillEllipse(27, 37 - flicker, 2.5, 2.2, RAMPS.gold.highlight);
    // Prehistoric ochre + K1 rock art cave paintings (bison & handprints on rock wall)
    sub.fillRect(12, 23, 5, 3, RAMPS.autumn.highlight);
    sub.fillRect(11, 22, 2, 2, RAMPS.magenta.highlight);
    sub.fillRect(40, 22, 4, 3, RAMPS.magenta.mid);
    sub.fillRect(41, 26, 2, 2, RAMPS.cyanMask.highlight);
  });
  drawSmokePlume(buf, 28, 23, frame, total, '#848B98AA');
  return buf;
}

function renderStoneShamanAltar(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(54, 48);
  drawGroundPlinth(buf, 27, 40, 21, 5.5, RAMPS.moss, RAMPS.slate);
  const pulse = Math.sin((frame / Math.max(1, total)) * Math.PI * 2);

  buf.layer((sub) => {
    // Stepped stone ritual dais + antler-framed spirit arch
    drawMasonryBox(sub, 15, 30, 24, 10, RAMPS.slate, 4, false);
    drawMasonryBox(sub, 20, 25, 14, 6, RAMPS.marble, 3, false);
    drawCurvedHorn(sub, 16, 30, 12, 11, 10, 21, 2.0, RAMPS.bone);
    drawCurvedHorn(sub, 38, 30, 42, 11, 44, 21, 2.0, RAMPS.bone);
    // Central skull totem & pulsing K1/K2 spirit brazier bowl
    sub.drawSkull(27, 29, 'mini', RAMPS.magenta.highlight, RAMPS.bone);
    sub.fillEllipse(27, 23, 3.8, 2.2, pulse > 0 ? RAMPS.cyanMask.highlight : RAMPS.magenta.highlight);
    // Hanging bone fetishes
    sub.drawLine(14, 18, 14, 24, RAMPS.magenta.mid, 1);
    sub.drawLine(40, 18, 40, 24, RAMPS.magenta.mid, 1);
  });
  drawSmokePlume(buf, 27, 19, frame, total, '#00DBDB88');
  return buf;
}

// ============================================================================
// БРОНЗА И ЖЕЛЕЗО (9)
// ============================================================================

function renderBronzeMudbrickHouse(): PixelBuffer {
  const buf = new PixelBuffer(54, 48);
  drawGroundPlinth(buf, 27, 40, 21, 5.5, RAMPS.sandstone, RAMPS.timber);
  // Warm sun-baked mudbrick walls + protruding timber ceiling vigas + K1 woven awning
  buf.layer((sub) => {
    drawMasonryBox(sub, 13, 18, 28, 22, RAMPS.sandstone, 6, true);
    // Roof parapet rim & timber beam ends
    sub.fillRect(12, 16, 30, 3, RAMPS.sandstone.highlight);
    sub.fillRect(36, 16, 6, 3, RAMPS.sandstone.shadow);
    for (let bx = 14; bx <= 34; bx += 4) {
      sub.fillRect(bx, 20, 2, 2, RAMPS.timber.deep);
    }
    // Arched recessed doorway + K1 striped market canopy
    drawArchedPortal(sub, 25, 40, 4, 9, RAMPS.timber, 'wood');
    sub.fillRect(15, 25, 11, 3, RAMPS.magenta.mid);
    sub.fillRect(17, 25, 3, 3, RAMPS.cyanMask.highlight);
    // Exterior rooftop timber ladder & terracotta amphorae
    sub.drawLine(39, 17, 42, 40, RAMPS.timber.mid, 1);
    sub.drawLine(42, 17, 45, 40, RAMPS.timber.shadow, 1);
    sub.fillEllipse(15, 37, 2.2, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.autumn));
  });
  return buf;
}

function renderBronzeGranary(): PixelBuffer {
  const buf = new PixelBuffer(56, 48);
  drawGroundPlinth(buf, 28, 40, 22, 5.5, RAMPS.sandstone, RAMPS.timber);
  // Twin domed beehive mudbrick grain silos + raised loading hatch + grain sacks
  buf.layer((sub) => {
    for (const sx of [20, 35]) {
      sub.fillEllipse(sx, 26, 8.5, 13.5, (nx, ny, _px, py) => {
        if (py > 38) return RAMPS.timber.deep;
        if (py % 4 === 0) return RAMPS.sandstone.shadow;
        return pickTopLeftTone(nx, ny, RAMPS.sandstone);
      });
      sub.fillRect(sx - 2, 12, 4, 2, RAMPS.magenta.mid);
    }
    // Timber loading hatch door & golden wheat grain sacks
    sub.fillRect(17, 30, 6, 8, RAMPS.timber.mid);
    sub.fillRect(18, 31, 4, 6, RAMPS.timber.deep);
    sub.fillEllipse(28, 37, 4.5, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.gold));
    sub.fillRect(33, 31, 5, 5, RAMPS.cyanMask.mid);
  });
  return buf;
}

function renderBronzeFurnaceSmithy(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 52);
  drawGroundPlinth(buf, 28, 44, 22, 5.5, RAMPS.slate, RAMPS.sandstone);
  const pulse = Math.sin((frame / Math.max(1, total)) * Math.PI * 2);

  buf.layer((sub) => {
    // Mudbrick & stone smelting chimney furnace glowing at crucible mouth
    drawMasonryBox(sub, 14, 15, 16, 28, RAMPS.sandstone, 4, true);
    drawMasonryBox(sub, 17, 8, 8, 8, RAMPS.slate, 2, false);
    sub.fillEllipse(22, 37, 4.2, 4.0, VOID);
    sub.fillEllipse(22, 38, 3.0, 2.5, pulse > 0 ? RAMPS.gold.highlight : RAMPS.lava.mid);
    // Wooden open workshop shed roof on right + anvil + molten bronze vat
    sub.fillRect(29, 26, 14, 16, RAMPS.timber.shadow);
    drawShingledRoof(sub, 36, 21, 9, 6, RAMPS.magenta, RAMPS.gold, false);
    sub.fillRect(33, 35, 6, 4, RAMPS.obsidian.highlight); // Anvil
    sub.fillEllipse(42, 38, 2.8, 2.4, RAMPS.copper.mid); // Patinated bronze shield stack
    sub.setPixel(42, 37, RAMPS.cyanMask.highlight);
  });
  drawSmokePlume(buf, 21, 7, frame, total, '#6A6378BB');
  return buf;
}

function renderBronzePotteryKiln(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(52, 46);
  drawGroundPlinth(buf, 26, 38, 20, 5.2, RAMPS.sandstone, RAMPS.timber);
  const glow = frame % 2;

  buf.layer((sub) => {
    // Domed terracotta beehive kiln + firing flue
    sub.fillEllipse(21, 27, 10, 11, (nx, ny, _px, py) => {
      if (py % 3 === 0 && ny < 0.3) return RAMPS.autumn.shadow;
      return pickTopLeftTone(nx, ny, RAMPS.autumn);
    });
    sub.fillRect(19, 13, 4, 4, RAMPS.sandstone.mid);
    sub.fillEllipse(21, 34, 3.6, 3.2, VOID);
    sub.fillEllipse(21, 35, 2.4, 2.0, glow === 0 ? RAMPS.gold.highlight : RAMPS.lava.mid);

    // Timber drying shelf stocked with terracotta & K1/K2 glazed amphorae
    sub.fillRect(32, 24, 11, 14, RAMPS.timber.shadow);
    sub.fillRect(31, 23, 13, 2, RAMPS.timber.highlight);
    sub.fillRect(31, 31, 13, 2, RAMPS.timber.mid);
    sub.fillEllipse(35, 28, 2.0, 2.8, RAMPS.autumn.highlight);
    sub.fillEllipse(40, 28, 2.0, 2.8, RAMPS.magenta.mid);
    sub.fillEllipse(37, 36, 2.3, 2.5, RAMPS.cyanMask.highlight);
  });
  drawSmokePlume(buf, 21, 11, frame, total, '#C4CAD699');
  return buf;
}

function renderBronzeZiggurat(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(60, 56);
  drawGroundPlinth(buf, 30, 48, 25, 6.2, RAMPS.sandstone, RAMPS.obsidian);
  // 3-tiered stepped Mesopotamian sandstone ziggurat + K1 glazed frieze + twin braziers
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 35, 42, 13, RAMPS.sandstone, 6, true);
    drawMasonryBox(sub, 14, 25, 32, 10, RAMPS.sandstone, 5, true);
    drawMasonryBox(sub, 20, 15, 20, 10, RAMPS.marble, 4, true);
    // Glazed K1 turquoise/magenta sanctuary trim & sun shrine capstone
    sub.fillRect(14, 25, 32, 2, RAMPS.magenta.mid);
    sub.fillRect(20, 15, 20, 2, RAMPS.cyanMask.highlight);
    drawMasonryBox(sub, 24, 9, 12, 6, RAMPS.gold, 3, false);
    // Grand central stairway cutting across tiers
    for (let y = 26; y <= 48; y += 2) {
      const w = 8 + Math.round((y - 26) * 0.18);
      sub.fillRect(30 - Math.floor(w / 2), y, w, 2, y % 4 === 0 ? RAMPS.marble.highlight : RAMPS.marble.mid);
    }
    drawArchedPortal(sub, 30, 25, 3, 7, RAMPS.gold, 'void');
  });
  drawBrazier(buf, 16, 23, frame * 0.4, RAMPS.lava);
  drawBrazier(buf, 44, 23, frame * 0.4 + 1.5, RAMPS.lava);
  drawWavingBanner(buf, 30, 4, frame, total, 6, 3);
  return buf;
}

function renderBronzeTimberGate(): PixelBuffer {
  const buf = new PixelBuffer(58, 48);
  drawGroundPlinth(buf, 29, 40, 24, 5.5, RAMPS.sandstone, RAMPS.timber);
  // Heavy stone base wall + timber palisade battlements + bronze-boss double gate
  buf.layer((sub) => {
    drawMasonryBox(sub, 8, 28, 42, 12, RAMPS.slate, 4, false);
    drawTimberWall(sub, 8, 16, 42, 14, RAMPS.sandstone, RAMPS.timber);
    drawCrenellations(sub, 8, 13, 42, RAMPS.timber);
    // Recessed double studded bronze/oak gate doors
    drawArchedPortal(sub, 29, 40, 6, 13, RAMPS.gold, 'wood');
    sub.fillEllipse(26, 34, 1.5, 1.5, RAMPS.gold.highlight);
    sub.fillEllipse(32, 34, 1.5, 1.5, RAMPS.gold.highlight);
    // Hanging K1/K2 bronze war banners flanking gateway
    sub.fillRect(14, 22, 4, 8, RAMPS.magenta.mid);
    sub.fillRect(15, 24, 2, 3, RAMPS.cyanMask.highlight);
    sub.fillRect(40, 22, 4, 8, RAMPS.magenta.shadow);
    sub.fillRect(41, 24, 2, 3, RAMPS.cyanMask.mid);
  });
  return buf;
}

function renderBronzeWatchtower(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(52, 58);
  drawGroundPlinth(buf, 26, 50, 19, 5.2, RAMPS.sandstone, RAMPS.slate);
  // Ashlar stone pedestal + tapered timber lookout frame + overhanging battle gallery
  buf.layer((sub) => {
    drawMasonryBox(sub, 18, 35, 16, 15, RAMPS.slate, 4, false);
    drawTimberWall(sub, 19, 20, 14, 16, RAMPS.sandstone, RAMPS.timber);
    // Cantilevered wooden fighting gallery & bronze brazier corner
    sub.fillRect(15, 16, 22, 5, RAMPS.timber.mid);
    sub.fillRect(15, 16, 17, 1, RAMPS.timber.highlight);
    drawCrenellations(sub, 15, 14, 22, RAMPS.timber);
    // K1 Shield hangings & spear doorway
    drawArchedPortal(sub, 26, 50, 3, 7, RAMPS.timber, 'wood');
    sub.fillEllipse(21, 18, 2.0, 2.0, RAMPS.magenta.mid);
    sub.fillEllipse(31, 18, 2.0, 2.0, RAMPS.cyanMask.highlight);
  });
  drawBrazier(buf, 19, 13, frame * 0.45, RAMPS.lava);
  drawWavingBanner(buf, 33, 6, frame, total, 7, 4);
  return buf;
}

function renderBronzeStoneWell(): PixelBuffer {
  const buf = new PixelBuffer(48, 48);
  drawGroundPlinth(buf, 24, 40, 18, 5.2, RAMPS.sandstone, RAMPS.moss);
  // Circular ashlar stone well curb + deep cool water + wooden A-frame rooflet & bucket
  buf.layer((sub) => {
    drawCylindricalTower(sub, 24, 27, 9, 13, RAMPS.sandstone, RAMPS.marble);
    sub.fillEllipse(24, 27, 8, 2.8, RAMPS.slate.deep);
    sub.fillEllipse(24, 27, 6.2, 2.0, RAMPS.ice.mid);
    sub.setPixel(22, 27, WATER_LINE.light);
    // Twin oak windlass posts & bronze winch
    sub.fillRect(15, 16, 2, 13, RAMPS.timber.mid);
    sub.fillRect(31, 16, 2, 13, RAMPS.timber.shadow);
    sub.drawLine(17, 21, 31, 21, RAMPS.gold.mid, 1);
    sub.drawLine(24, 21, 24, 26, RAMPS.sandstone.highlight, 1);
    // Shingled gabled K1/K2 canopy roof
    drawShingledRoof(sub, 24, 10, 11, 7, RAMPS.magenta, RAMPS.gold, false);
    // Spilled stone water bucket beside well
    sub.fillRect(11, 36, 4, 4, RAMPS.timber.mid);
    sub.fillEllipse(35, 39, 3, 1.5, RAMPS.ice.highlight);
  });
  return buf;
}

function renderBronzeWoodenPier(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 44);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  // Animated sea water base underneath timber pilings
  for (let y = 26; y < 42; y++) {
    for (let x = 3; x < 55; x++) {
      const wave = (x + frame * 2 + y * 3) % 9 === 0;
      buf.setPixel(x, y, wave ? WATER_LINE.light : y > 35 ? '#0C3554' : RAMPS.ice.deep);
    }
  }
  // Stone shore abutment left + timber piling dock planks + crates + moored skiff
  buf.layer((sub) => {
    drawMasonryBox(sub, 4, 17, 13, 18, RAMPS.sandstone, 3, false);
    for (const px of [20, 31, 42, 50]) {
      sub.fillRect(px, 20, 3, 19, RAMPS.timber.deep);
      sub.fillRect(px, 20, 1, 19, RAMPS.timber.mid);
    }
    // Dock timber deck planks
    sub.fillRect(13, 21, 40, 4, RAMPS.timber.mid);
    sub.fillRect(13, 21, 36, 1, RAMPS.timber.highlight);
    // Cargo crates & amphorae
    sub.fillRect(22, 16, 6, 5, RAMPS.sandstone.mid);
    sub.fillRect(29, 17, 4, 4, RAMPS.autumn.mid);
    sub.setPixel(24, 18, RAMPS.cyanMask.highlight);
    // Bobbing wooden boat moored at pier end
    const bob = Math.round(Math.sin(t) * 1.0);
    sub.fillEllipse(43, 35 + bob, 8.5, 2.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
    sub.fillRect(42, 28 + bob, 2, 7, RAMPS.timber.highlight);
  });
  drawWavingBanner(buf, 11, 8, frame, total, 6, 3);
  return buf;
}

// ============================================================================
// СРЕДНЕВЕКОВЬЕ (10)
// ============================================================================

function renderMedievalStoneHouse(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(54, 52);
  drawGroundPlinth(buf, 27, 44, 21, 5.2, RAMPS.slate, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 13, 31, 28, 13, RAMPS.slate, 5, true);
    drawTimberWall(sub, 12, 21, 30, 11, RAMPS.sandstone, RAMPS.timber);
    drawMasonryBox(sub, 33, 8, 5, 13, RAMPS.slate, 1, false);
    drawShingledRoof(sub, 27, 9, 16, 12, RAMPS.magenta, RAMPS.timber, false);
    drawGlowingWindow(sub, 16, 24, 3, 4, RAMPS.gold, RAMPS.timber.shadow);
    drawGlowingWindow(sub, 30, 24, 3, 4, RAMPS.gold, RAMPS.timber.shadow);
    drawArchedPortal(sub, 23, 44, 4, 9, RAMPS.timber, 'wood');
    sub.fillRect(15, 34, 3, 6, RAMPS.cyanMask.mid);
  });
  drawSmokePlume(buf, 35, 6, frame, total);
  return buf;
}

function renderMedievalTavern(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 54);
  drawGroundPlinth(buf, 29, 46, 24, 5.5, RAMPS.sandstone, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 11, 32, 36, 14, RAMPS.slate, 6, true);
    drawTimberWall(sub, 10, 20, 38, 13, RAMPS.sandstone, RAMPS.timber);
    drawMasonryBox(sub, 37, 8, 6, 13, RAMPS.slate, 2, false);
    drawShingledRoof(sub, 29, 8, 20, 13, RAMPS.magenta, RAMPS.gold, false);
    // Glowing warm inn windows & oak ale barrels at porch
    drawGlowingWindow(sub, 15, 23, 4, 4, RAMPS.gold, RAMPS.timber.shadow);
    drawGlowingWindow(sub, 26, 23, 4, 4, RAMPS.gold, RAMPS.timber.shadow);
    drawArchedPortal(sub, 23, 46, 5, 10, RAMPS.timber, 'wood');
    sub.fillEllipse(14, 43, 2.5, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
    sub.fillEllipse(35, 43, 2.5, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
    // Hanging tavern tankard sign
    sub.drawLine(31, 34, 37, 34, RAMPS.obsidian.mid, 1);
    sub.fillRect(34, 35, 4, 4, RAMPS.gold.mid);
    sub.setPixel(35, 36, RAMPS.cyanMask.highlight);
  });
  drawSmokePlume(buf, 40, 6, frame, total);
  return buf;
}

function renderMedievalSmithy(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 52);
  drawGroundPlinth(buf, 28, 44, 22, 5.5, RAMPS.slate, RAMPS.obsidian);
  const pulse = Math.sin((frame / Math.max(1, total)) * Math.PI * 2);

  buf.layer((sub) => {
    drawMasonryBox(sub, 11, 18, 17, 26, RAMPS.slate, 4, true);
    drawMasonryBox(sub, 15, 7, 7, 11, RAMPS.slate, 2, false);
    drawTimberWall(sub, 27, 25, 17, 19, RAMPS.sandstone, RAMPS.timber);
    drawShingledRoof(sub, 35, 16, 11, 10, RAMPS.magenta, RAMPS.obsidian, false);
    // Glowing forge hearth & sparks + heavy steel anvil + weapon rack
    sub.fillEllipse(19, 38, 4.5, 4.0, VOID);
    sub.fillEllipse(19, 39, 3.2, 2.5, pulse > 0 ? RAMPS.gold.highlight : RAMPS.lava.mid);
    sub.fillRect(33, 37, 6, 4, RAMPS.marble.mid);
    sub.fillRect(32, 36, 8, 2, RAMPS.marble.highlight);
    sub.fillRect(42, 34, 3, 7, RAMPS.cyanMask.mid);
  });
  drawSmokePlume(buf, 18, 5, frame, total, '#5B616CBB');
  return buf;
}

function renderMedievalWindmill(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 62);
  drawGroundPlinth(buf, 28, 54, 21, 5.5, RAMPS.sandstone, RAMPS.slate);
  // Tapered cylindrical stone mill tower + conical K1 roof
  buf.layer((sub) => {
    drawCylindricalTower(sub, 28, 22, 10, 31, RAMPS.marble, RAMPS.timber);
    drawShingledRoof(sub, 28, 10, 12, 12, RAMPS.magenta, RAMPS.gold, true);
    drawArchedPortal(sub, 28, 53, 4, 9, RAMPS.timber, 'wood');
    drawGlowingWindow(sub, 26, 33, 3, 4, RAMPS.gold, RAMPS.slate.deep);
    sub.fillEllipse(19, 51, 3.2, 2.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.sail));
  });
  // Rotating 4-blade timber & linen sail arms
  const baseAng = (frame / Math.max(1, total)) * (Math.PI / 2);
  buf.layer((sub) => {
    for (let i = 0; i < 4; i++) {
      const a = baseAng + i * (Math.PI / 2);
      sub.drawRotatedRect(28, 22, 17, 1.0, a, () => RAMPS.timber.mid);
      sub.drawRotatedRect(
        28 + Math.cos(a) * 5,
        22 + Math.sin(a) * 5,
        11,
        2.5,
        a,
        (_u, v) => (v > 0.4 ? RAMPS.sail.shadow : RAMPS.sail.highlight)
      );
    }
    sub.fillEllipse(28, 22, 2.5, 2.5, RAMPS.gold.mid);
    sub.setPixel(27, 21, RAMPS.cyanMask.highlight);
  });
  return buf;
}

function renderMedievalChurch(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 62);
  drawGroundPlinth(buf, 29, 54, 24, 5.8, RAMPS.slate, RAMPS.marble);
  const p = frame / Math.max(1, total);
  const bellSwing = Math.round(Math.sin(p * Math.PI * 2) * 1.2);
  const moteY = Math.round(Math.cos(p * Math.PI * 2) * 2.0);
  const moteX = Math.round(Math.sin(p * Math.PI * 2) * 2.5);

  buf.layer((sub) => {
    // Nave hall + tall western bell tower belfry
    drawMasonryBox(sub, 11, 29, 24, 24, RAMPS.marble, 5, true);
    drawShingledRoof(sub, 23, 18, 13, 11, RAMPS.magenta, RAMPS.gold, false);
    drawMasonryBox(sub, 33, 17, 13, 36, RAMPS.marble, 4, true);
    drawShingledRoof(sub, 39, 5, 8, 12, RAMPS.magenta, RAMPS.gold, true);
    // Golden belfry cross & swinging bronze church bell inside belfry arch
    sub.drawLine(39, 2, 39, 6, RAMPS.gold.highlight, 1);
    sub.drawLine(37, 3, 41, 3, RAMPS.gold.highlight, 1);
    drawGlowingWindow(sub, 38, 21, 3, 5, RAMPS.gold, RAMPS.slate.deep);
    sub.fillRect(39 + bellSwing, 23, 2, 3, RAMPS.gold.highlight);
    // Stained-glass K1/K2 nave lancets & grand rose window
    drawGlowingWindow(sub, 15, 34, 3, 6, RAMPS.magenta, RAMPS.gold.mid);
    drawGlowingWindow(sub, 27, 34, 3, 6, RAMPS.cyanMask, RAMPS.gold.mid);
    drawArchedPortal(sub, 22, 53, 4, 9, RAMPS.timber, 'wood');
    // Sanctum lantern & floating golden blessing mote over churchyard
    sub.setPixel(17 + (frame % 2), 48, RAMPS.gold.highlight);
    sub.setPixel(27, 48 + ((frame + 1) % 2), RAMPS.gold.highlight);
    sub.setPixel(23 + moteX, 13 + moteY, RAMPS.gold.highlight);
  });
  return buf;
}

function renderMedievalCastleWalls(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(62, 54);
  drawGroundPlinth(buf, 31, 46, 26, 5.8, RAMPS.slate, RAMPS.obsidian);
  buf.layer((sub) => {
    // Flanking crenelated cylindrical drum gatehouse towers + curtain wall
    drawCylindricalTower(sub, 12, 20, 6, 26, RAMPS.marble, RAMPS.slate);
    drawCrenellations(sub, 6, 17, 13, RAMPS.marble);
    drawCylindricalTower(sub, 50, 20, 6, 26, RAMPS.marble, RAMPS.slate);
    drawCrenellations(sub, 44, 17, 13, RAMPS.marble);

    drawMasonryBox(sub, 17, 25, 28, 21, RAMPS.slate, 5, true);
    drawCrenellations(sub, 17, 22, 28, RAMPS.marble);
    drawArchedPortal(sub, 31, 46, 6, 12, RAMPS.marble, 'portcullis');
    // Royal heraldic crests
    sub.fillRect(10, 28, 4, 7, RAMPS.magenta.mid);
    sub.fillRect(11, 30, 2, 3, RAMPS.cyanMask.highlight);
    sub.fillRect(48, 28, 4, 7, RAMPS.magenta.shadow);
    sub.fillRect(49, 30, 2, 3, RAMPS.cyanMask.mid);
  });
  drawWavingBanner(buf, 12, 7, frame, total, 7, 4);
  drawWavingBanner(buf, 50, 7, frame + 3, total, 7, 4);
  return buf;
}

function renderMedievalArcherTower(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(50, 60);
  drawGroundPlinth(buf, 25, 52, 18, 5.0, RAMPS.slate, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 24, 16, 28, RAMPS.slate, 4, true);
    // Arrow loopholes down masonry
    sub.fillRect(23, 30, 2, 5, VOID);
    sub.fillRect(23, 39, 2, 5, VOID);
    // Cantilevered wooden hoarding gallery + conical K1 slate/banner spire
    drawTimberWall(sub, 14, 15, 22, 9, RAMPS.sandstone, RAMPS.timber);
    drawShingledRoof(sub, 25, 6, 13, 10, RAMPS.magenta, RAMPS.gold, true);
    drawArchedPortal(sub, 25, 52, 3, 7, RAMPS.timber, 'wood');
    sub.fillEllipse(19, 19, 2, 2, RAMPS.cyanMask.highlight);
    sub.fillEllipse(31, 19, 2, 2, RAMPS.cyanMask.mid);
  });
  drawWavingBanner(buf, 25, 2, frame, total, 6, 3);
  return buf;
}

function renderMedievalBarracks(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 52);
  drawGroundPlinth(buf, 29, 44, 24, 5.5, RAMPS.slate, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 10, 29, 38, 15, RAMPS.slate, 6, true);
    drawTimberWall(sub, 10, 21, 38, 9, RAMPS.sandstone, RAMPS.timber);
    drawShingledRoof(sub, 29, 10, 20, 12, RAMPS.magenta, RAMPS.slate, false);
    drawArchedPortal(sub, 29, 44, 5, 10, RAMPS.timber, 'portcullis');
    // Garrison shield & spear racks flanking entrance
    sub.fillEllipse(16, 36, 3.0, 3.5, RAMPS.cyanMask.highlight);
    sub.fillEllipse(42, 36, 3.0, 3.5, RAMPS.magenta.highlight);
    sub.drawLine(12, 30, 12, 42, RAMPS.marble.highlight, 1);
    sub.drawLine(46, 30, 46, 42, RAMPS.marble.highlight, 1);
  });
  drawWavingBanner(buf, 15, 7, frame, total, 6, 3);
  drawWavingBanner(buf, 43, 7, frame + 4, total, 6, 3);
  return buf;
}

function renderMedievalMarket(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 48);
  drawGroundPlinth(buf, 29, 41, 25, 5.5, RAMPS.sandstone, RAMPS.slate);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const swayX = Math.sin(t) * 0.9;
  const flicker = (Math.sin(t * 2) + 1) * 0.5;

  // Rear guild warehouse & weighing archway behind market stalls
  buf.layer((sub) => {
    drawMasonryBox(sub, 16, 17, 26, 20, RAMPS.sandstone, 5, true);
    drawTimberWall(sub, 17, 12, 24, 9, RAMPS.birch, RAMPS.timber);
    drawShingledRoof(sub, 29, 4, 15, 9, RAMPS.timber, RAMPS.gold, false);
    drawArchedPortal(sub, 29, 37, 3, 7, RAMPS.slate, 'wood');
    drawGlowingWindow(sub, 20, 14, 3, 3, RAMPS.gold, RAMPS.timber.shadow);
    drawGlowingWindow(sub, 35, 14, 3, 3, RAMPS.gold, RAMPS.timber.shadow);
  });

  // Left & Right wooden merchant stalls with angled striped K1/K2 scalloped canopies
  buf.layer((sub) => {
    // Timber support posts & plank counters
    for (const [sx, w, canopyRamp] of [
      [6, 19, RAMPS.magenta],
      [33, 19, RAMPS.cyanMask],
    ] as const) {
      // Rear shadow interior behind counter
      sub.fillRect(sx + 2, 24, w - 4, 15, RAMPS.timber.deep);
      // Heavy oak vertical posts (top-left lit)
      sub.fillRect(sx + 1, 21, 2, 19, RAMPS.timber.highlight);
      sub.fillRect(sx + w - 3, 21, 2, 19, RAMPS.timber.shadow);
      // Plank merchant counter front + sunlit counter top
      sub.fillRect(sx + 1, 32, w - 2, 7, RAMPS.timber.mid);
      sub.fillRect(sx + 1, 32, w - 2, 2, RAMPS.timber.highlight);
      sub.fillRect(sx + w - 4, 33, 3, 6, RAMPS.timber.shadow);
      // Sloped striped awning + scalloped valance eave
      for (let dy = 0; dy < 7; dy++) {
        const py = 18 + dy;
        const inset = Math.max(0, 2 - Math.floor(dy / 2));
        for (let x = sx - 1 + inset; x <= sx + w - inset; x++) {
          const isStripe = Math.floor((x - sx) / 3) % 2 === 0;
          const isValance = dy === 6;
          if (isValance && (x - sx) % 3 === 1) continue; // scalloped edge
          if (dy === 0) {
            sub.setPixel(x, py, isStripe ? canopyRamp.highlight : RAMPS.birch.highlight);
          } else if (isValance) {
            sub.setPixel(x, py, isStripe ? canopyRamp.deep : RAMPS.birch.shadow);
          } else if (dy >= 4) {
            sub.setPixel(x, py, isStripe ? canopyRamp.shadow : RAMPS.birch.mid);
          } else {
            sub.setPixel(x, py, isStripe ? canopyRamp.mid : RAMPS.birch.highlight);
          }
        }
      }
    }

    // Left stall wares: wooden apple crates, bread loaves & sack of grain
    sub.fillRect(9, 28, 6, 4, RAMPS.timber.highlight);
    sub.fillEllipse(12, 27, 2.6, 1.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.lava));
    sub.fillRect(16, 29, 6, 3, RAMPS.gold.mid);
    sub.fillEllipse(18, 28, 2.0, 1.3, RAMPS.gold.highlight);
    sub.fillEllipse(8, 38, 2.8, 2.4, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.birch));

    // Right stall wares: folded K1 silk bolts, bronze amphora & spoked cartwheel
    sub.fillRect(36, 27, 7, 5, RAMPS.magenta.mid);
    sub.fillRect(36, 27, 3, 5, RAMPS.magenta.highlight);
    sub.fillRect(43, 28, 4, 4, RAMPS.cyanMask.highlight);
    // Iron-hooped oak barrel & leaning wooden spoked cartwheel
    sub.fillEllipse(49, 36, 3.2, 3.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
    sub.drawLine(46, 35, 51, 35, RAMPS.slate.mid, 1);
    sub.drawLine(46, 37, 51, 37, RAMPS.slate.shadow, 1);
    sub.fillEllipse(24, 38, 3.5, 3.5, (nx, ny) => {
      const r = Math.hypot(nx, ny);
      if (r < 0.28) return RAMPS.slate.highlight;
      if (r < 0.72) return Math.abs(nx) < 0.2 || Math.abs(ny) < 0.2 ? RAMPS.timber.mid : null;
      return nx < 0 ? RAMPS.timber.highlight : RAMPS.timber.shadow;
    });
  });

  // Central guild sign bracket + swinging golden lantern + waving banner
  drawSwingingLantern(buf, 29, 24, swayX, flicker);
  drawWavingBanner(buf, 29, 2, frame, total, 7, 4);
  return buf;
}

function renderMedievalPort(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(62, 52);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  // Animated sea waves in right/lower harbor basin
  for (let y = 30; y < 50; y++) {
    for (let x = 22; x < 60; x++) {
      const foam = (x + frame * 2 + y * 3) % 8 === 0;
      buf.setPixel(x, y, foam ? WATER_LINE.light : y > 40 ? '#0A2C46' : RAMPS.ice.deep);
    }
  }
  // Stone seawall quay & guild warehouse + wooden harbor crane + moored merchant ship
  buf.layer((sub) => {
    drawMasonryBox(sub, 4, 31, 32, 15, RAMPS.slate, 5, false);
    drawTimberWall(sub, 6, 17, 18, 14, RAMPS.sandstone, RAMPS.timber);
    drawShingledRoof(sub, 15, 8, 11, 9, RAMPS.magenta, RAMPS.gold, false);
    drawArchedPortal(sub, 14, 31, 3, 7, RAMPS.timber, 'wood');

    // Timber cargo crane swinging over dock edge
    sub.fillRect(28, 16, 3, 16, RAMPS.timber.mid);
    sub.drawLine(29, 17, 42, 13, RAMPS.timber.highlight, 2);
    sub.drawLine(41, 14, 41, 25, RAMPS.sandstone.highlight, 1);
    sub.fillRect(39, 25, 5, 4, RAMPS.sandstone.mid);

    // Moored ship hull bobbing in harbor
    const bob = Math.round(Math.sin(t) * 1.0);
    sub.fillEllipse(48, 39 + bob, 9.5, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
    sub.fillRect(47, 25 + bob, 2, 14, RAMPS.timber.highlight);
    sub.fillRect(49, 26 + bob, 6, 7, RAMPS.sail.highlight);
    sub.fillRect(50, 28 + bob, 4, 3, RAMPS.magenta.mid);
  });
  drawWavingBanner(buf, 15, 2, frame, total, 6, 3);
  return buf;
}

export const ERA_STRUCTURE_MODELS: PixelModelDef[] = [
  // ЛЕДНИКОВЬЕ (3)
  makeBuildingDef({
    id: 'ice-campfire',
    name: 'Охотничий Костёр Стоянки',
    subtitle: 'Очаг стоянки ледниковья (48×42)',
    era: 'ice-age',
    buildingFunction: 'food',
    kind: 'animated',
    tier: 'I',
    faction: 'Орда',
    width: 48,
    height: 42,
    frameCount: 12,
    layersSpec: ['1. Каменное кольцо и снег', '2. Перекладина для дичи', '3. Живое пламя и дым'],
    description: 'Стояночный костёр охотников на мамонтов с рогатиной для жарки мяса и тёплыми шкурами.',
    renderReady: renderIceCampfire,
  }),
  makeBuildingDef({
    id: 'ice-hide-shelter',
    name: 'Навес из Шкур',
    subtitle: 'Лёгкое укрытие охотников (54×46)',
    era: 'ice-age',
    buildingFunction: 'housing',
    kind: 'static',
    tier: 'I',
    faction: 'Орда',
    width: 54,
    height: 46,
    frameCount: 1,
    layersSpec: ['1. Жерди каркаса', '2. Сшитые шкуры и рога', '3. Родовой знак державы'],
    description: 'Утеплённый шатёр из выделанных шкур на деревянных шестах, спасающий племя от метели.',
    renderReady: renderIceHideShelter,
  }),
  makeBuildingDef({
    id: 'ice-mammoth-hut',
    name: 'Хижина из Костей Мамонта',
    subtitle: 'Жилище ледникового племени (58×52)',
    era: 'ice-age',
    buildingFunction: 'housing',
    kind: 'animated',
    tier: 'II',
    faction: 'Орда',
    width: 58,
    height: 52,
    frameCount: 12,
    layersSpec: ['1. Купол из шкур и дерна', '2. Своды из бивней мамонта', '3. Очаг, стяг и дым'],
    description: 'Прочное тёплое жилище, собранное на арках гигантских бивней мамонта и покрытое шкурами.',
    renderReady: renderIceMammothHut,
  }),

  // КАМЕННЫЙ ВЕК (10)
  makeBuildingDef({
    id: 'stone-wigwam-hut',
    name: 'Шалаш из Веток',
    subtitle: 'Первое жилище племени (52×48)',
    era: 'stone-age',
    buildingFunction: 'housing',
    kind: 'static',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 52,
    height: 48,
    frameCount: 1,
    layersSpec: ['1. Конусный каркас из жердей', '2. Кора, ветки и узор', '3. Талисман над входом'],
    description: 'Плетёный конический шалаш из веток, коры и сухой травы с оберегом над входом.',
    renderReady: renderStoneWigwam,
  }),
  makeBuildingDef({
    id: 'stone-dugout',
    name: 'Землянка Племени',
    subtitle: 'Тёплое полуподземное жильё (54×46)',
    era: 'stone-age',
    buildingFunction: 'housing',
    kind: 'animated',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 54,
    height: 46,
    frameCount: 12,
    layersSpec: ['1. Дёрновый холм', '2. Бревенчатый вход и знамя', '3. Дымок из печной трубы'],
    description: 'Углублённая в землю постройка с дёрновой крышей, защищённая от ветров и ночного холода.',
    renderReady: renderStoneDugout,
  }),
  makeBuildingDef({
    id: 'stone-hearth-pit',
    name: 'Костровище Племени',
    subtitle: 'Очаг приготовления пищи (50×42)',
    era: 'stone-age',
    buildingFunction: 'food',
    kind: 'animated',
    tier: 'I',
    faction: 'Орда',
    width: 50,
    height: 42,
    frameCount: 12,
    layersSpec: ['1. Кольцо камней очага', '2. Тренога с котлом', '3. Огонь, угли и дым'],
    description: 'Общее костровище каменного века с глиняным котлом на треноге и запасом валежника.',
    renderReady: renderStoneHearthPit,
  }),
  makeBuildingDef({
    id: 'stone-totem-pole',
    name: 'Тотемный Столб',
    subtitle: 'Резной идол предков (46×58)',
    era: 'stone-age',
    buildingFunction: 'religion',
    kind: 'static',
    tier: 'I',
    faction: 'Орда',
    width: 46,
    height: 58,
    frameCount: 1,
    layersSpec: ['1. Основание из валунов', '2. Ствол с тремя ликами', '3. Крылья птицы-грома'],
    description: 'Высокий резной кедровый столб с раскрашенными ликами тотемных зверей и духов.',
    renderReady: renderStoneTotemPole,
  }),
  makeBuildingDef({
    id: 'stone-menhir',
    name: 'Мегалит-Менгир',
    subtitle: 'Древний камень силы (48×56)',
    era: 'stone-age',
    buildingFunction: 'religion',
    kind: 'static',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 48,
    height: 56,
    frameCount: 1,
    layersSpec: ['1. Монолит гранита', '2. Спиральные петроглифы', '3. Мшистый алтарный круг'],
    description: 'Вкопанный вертикальный мегалит эпохи неолита с высеченными солярными знаками.',
    renderReady: renderStoneMenhir,
  }),
  makeBuildingDef({
    id: 'stone-circle-sanctuary',
    name: 'Круг Камней',
    subtitle: 'Мегалитический кромлех (60×52)',
    era: 'stone-age',
    buildingFunction: 'religion',
    kind: 'animated',
    tier: 'III',
    faction: 'Лесной Круг',
    width: 60,
    height: 52,
    frameCount: 12,
    layersSpec: ['1. Задние арки-трилиты', '2. Алтарь солнцестояния', '3. Парящий духовный сгусток'],
    description: 'Величественное кольцо стоячих трилитов, отмечающее дни солнцестояний и племенных обрядов.',
    renderReady: renderStoneCircle,
  }),
  makeBuildingDef({
    id: 'stone-palisade',
    name: 'Деревянный Частокол',
    subtitle: 'Оборонительная ограда (56×46)',
    era: 'stone-age',
    buildingFunction: 'defense',
    kind: 'static',
    tier: 'I',
    faction: 'Орда',
    width: 56,
    height: 46,
    frameCount: 1,
    layersSpec: ['1. Заострённые брёвна', '2. Перевязка и помост', '3. Ворота со щитами клана'],
    description: 'Прочная стена из вкопанных заострённых брёвен с узким проходом и племенными щитами.',
    renderReady: renderStonePalisade,
  }),
  makeBuildingDef({
    id: 'stone-animal-pen',
    name: 'Загон для Скота',
    subtitle: 'Плетёный загон и кормушка (56×46)',
    era: 'stone-age',
    buildingFunction: 'food',
    kind: 'static',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 56,
    height: 46,
    frameCount: 1,
    layersSpec: ['1. Плетёная изгородь', '2. Копна сена и поилка', '3. Метка державы у ворот'],
    description: 'Огороженный плетнём загон для первых приручённых стад со стогом сена и каменной поилкой.',
    renderReady: renderStoneAnimalPen,
  }),
  makeBuildingDef({
    id: 'stone-cave-dwelling',
    name: 'Пещерное Жилище',
    subtitle: 'Грот с наскальной живописью (58×50)',
    era: 'stone-age',
    buildingFunction: 'housing',
    kind: 'animated',
    tier: 'II',
    faction: 'Орда',
    width: 58,
    height: 50,
    frameCount: 12,
    layersSpec: ['1. Известняковый грот и дёрн', '2. Наскальные рисунки охрой', '3. Костёр внутри и дымок'],
    description: 'Естественный каменный грот, расписанный силуэтами бизонов и охряными отпечатками ладоней.',
    renderReady: renderStoneCaveDwelling,
  }),
  makeBuildingDef({
    id: 'stone-shaman-altar',
    name: 'Ритуальное Место Шамана',
    subtitle: 'Алтарь рогов и духов (54×48)',
    era: 'stone-age',
    buildingFunction: 'religion',
    kind: 'animated',
    tier: 'II',
    faction: 'Орда',
    width: 54,
    height: 48,
    frameCount: 12,
    layersSpec: ['1. Каменный подиум', '2. Арка из рогов и амулетов', '3. Мерцающий дым благовоний'],
    description: 'Святилище шамана под сенью рогов оленя с курильницей, черепами и амулетами предков.',
    renderReady: renderStoneShamanAltar,
  }),

  // БРОНЗА И ЖЕЛЕЗО (9)
  makeBuildingDef({
    id: 'bronze-mudbrick-house',
    name: 'Глинобитный Дом',
    subtitle: 'Жилой дом раннего города (54×48)',
    era: 'bronze-iron',
    buildingFunction: 'housing',
    kind: 'static',
    tier: 'I',
    faction: 'Цитадель',
    width: 54,
    height: 48,
    frameCount: 1,
    layersSpec: ['1. Саманные стены и балки', '2. Тканый навес и лестница', '3. Глиняные амфоры'],
    description: 'Квадратный саманный дом с плоской кровлей-террасой, лестницей, навесом и амфорами у порога.',
    renderReady: renderBronzeMudbrickHouse,
  }),
  makeBuildingDef({
    id: 'bronze-granary',
    name: 'Амбар Бронзового Века',
    subtitle: 'Купольные зернохранилища (56×48)',
    era: 'bronze-iron',
    buildingFunction: 'food',
    kind: 'static',
    tier: 'I',
    faction: 'Гильдия',
    width: 56,
    height: 48,
    frameCount: 1,
    layersSpec: ['1. Два саманных купола-силоса', '2. Люк загрузки', '3. Мешки с золотым зерном'],
    description: 'Парные купольные амбары из обожжённого кирпича для долгого хранения урожая и муки.',
    renderReady: renderBronzeGranary,
  }),
  makeBuildingDef({
    id: 'bronze-furnace-smithy',
    name: 'Кузница с Горном',
    subtitle: 'Плавильня бронзы и железа (56×52)',
    era: 'bronze-iron',
    buildingFunction: 'production',
    kind: 'animated',
    tier: 'II',
    faction: 'Гильдия',
    width: 56,
    height: 52,
    frameCount: 12,
    layersSpec: ['1. Дымоходная печь-домница', '2. Навес с наковальней', '3. Жар горна и дым'],
    description: 'Ранняя металлургическая мастерская с кирпичным сыродутным горном, наковальней и щитами.',
    renderReady: renderBronzeFurnaceSmithy,
  }),
  makeBuildingDef({
    id: 'bronze-pottery-kiln',
    name: 'Гончарная Мастерская',
    subtitle: 'Печь обжига и стеллаж сосудов (52×46)',
    era: 'bronze-iron',
    buildingFunction: 'production',
    kind: 'animated',
    tier: 'I',
    faction: 'Гильдия',
    width: 52,
    height: 46,
    frameCount: 12,
    layersSpec: ['1. Купольная печь обжига', '2. Полки с амфорами', '3. Жар топки и дым'],
    description: 'Мастерская гончара с купольной печью обжига и рядами расписных глиняных амфор.',
    renderReady: renderBronzePotteryKiln,
  }),
  makeBuildingDef({
    id: 'bronze-ziggurat-shrine',
    name: 'Святилище-Зиккурат',
    subtitle: 'Ступенчатый храм солнца (60×56)',
    era: 'bronze-iron',
    buildingFunction: 'religion',
    kind: 'animated',
    tier: 'III',
    faction: 'Цитадель',
    width: 60,
    height: 56,
    frameCount: 12,
    layersSpec: ['1. Три яруса ступеней', '2. Парадная лестница и глазурь', '3. Жаровни и храмовый стяг'],
    description: 'Монументальный трёхъярусный зиккурат из песчаника и глазурованного кирпича с вечными огнями.',
    renderReady: renderBronzeZiggurat,
  }),
  makeBuildingDef({
    id: 'bronze-timber-gate',
    name: 'Деревянная Стена с Воротами',
    subtitle: 'Укрепление с бронзовой обивкой (58×48)',
    era: 'bronze-iron',
    buildingFunction: 'defense',
    kind: 'static',
    tier: 'I',
    faction: 'Цитадель',
    width: 58,
    height: 48,
    frameCount: 1,
    layersSpec: ['1. Каменный цоколь и сруб', '2. Заборолы наверху', '3. Двустворчатые ворота с бляхами'],
    description: 'Городские деревянные стены на каменном основании со створками ворот, обитыми бронзой.',
    renderReady: renderBronzeTimberGate,
  }),
  makeBuildingDef({
    id: 'bronze-watchtower',
    name: 'Сторожевая Башня Бронзы',
    subtitle: 'Сигнальная дозорная вышка (52×58)',
    era: 'bronze-iron',
    buildingFunction: 'defense',
    kind: 'animated',
    tier: 'II',
    faction: 'Цитадель',
    width: 52,
    height: 58,
    frameCount: 12,
    layersSpec: ['1. Каменный фундамент', '2. Фахверковый ствол', '3. Площадка, маяк и вымпел'],
    description: 'Высокая сигнально-дозорная вышка с бронзовым сигнальным костром и навесным помостом.',
    renderReady: renderBronzeWatchtower,
  }),
  makeBuildingDef({
    id: 'bronze-stone-well',
    name: 'Каменный Колодец',
    subtitle: 'Источник чистой воды (48×48)',
    era: 'bronze-iron',
    buildingFunction: 'food',
    kind: 'static',
    tier: 'I',
    faction: 'Гильдия',
    width: 48,
    height: 48,
    frameCount: 1,
    layersSpec: ['1. Круглая каменная кладка', '2. Деревянный ворот с ведром', '3. Черепичный навес'],
    description: 'Облицованный тёсаным песчаником колодец с воротом на дубовых опорах и черепичным навесом.',
    renderReady: renderBronzeStoneWell,
  }),
  makeBuildingDef({
    id: 'bronze-wooden-pier',
    name: 'Пристань Бронзового Века',
    subtitle: 'Свайный причал с ладьёй (58×44)',
    era: 'bronze-iron',
    buildingFunction: 'production',
    kind: 'animated',
    tier: 'I',
    faction: 'Гильдия',
    width: 58,
    height: 44,
    frameCount: 12,
    layersSpec: ['1. Волны акватории', '2. Сваи и дощатый настил', '3. Грузы и качающаяся лодка'],
    description: 'Деревянный причал на сваях с ящиками товаров и покачивающейся на волнах торговой лодкой.',
    renderReady: renderBronzeWoodenPier,
  }),

  // СРЕДНЕВЕКОВЬЕ (10)
  makeBuildingDef({
    id: 'medieval-stone-house',
    name: 'Каменный Городской Дом',
    subtitle: 'Двухэтажный бюргерский дом (54×52)',
    era: 'medieval',
    buildingFunction: 'housing',
    kind: 'animated',
    tier: 'I',
    faction: 'Гильдия',
    width: 54,
    height: 52,
    frameCount: 12,
    layersSpec: ['1. Каменный низ и фахверк', '2. Черепичная крутая крыша', '3. Тёплые окна и дым очага'],
    description: 'Уютный средневековый городской дом с каменным первым этажом, фахверковым верхом и камином.',
    renderReady: renderMedievalStoneHouse,
  }),
  makeBuildingDef({
    id: 'medieval-tavern',
    name: 'Таверна Гильдии',
    subtitle: 'Постоялый двор с вывеской (58×54)',
    era: 'medieval',
    buildingFunction: 'food',
    kind: 'animated',
    tier: 'II',
    faction: 'Гильдия',
    width: 58,
    height: 54,
    frameCount: 12,
    layersSpec: ['1. Два яруса залы и фахверк', '2. Дубовые бочки и вывеска', '3. Свет окон и печной дым'],
    description: 'Оживлённая таверна с подвесной вывеской кружки, бочками эля у крыльца и жарким камином.',
    renderReady: renderMedievalTavern,
  }),
  makeBuildingDef({
    id: 'medieval-smithy',
    name: 'Средневековая Кузница',
    subtitle: 'Оружейный цех и горн (56×52)',
    era: 'medieval',
    buildingFunction: 'production',
    kind: 'animated',
    tier: 'II',
    faction: 'Цитадель',
    width: 56,
    height: 52,
    frameCount: 12,
    layersSpec: ['1. Каменная печь-горн', '2. Наковальня и стойка мечей', '3. Жар углей и густой дым'],
    description: 'Оружейная кузница королевства с мощным каменным горном, стальной наковальней и клинками.',
    renderReady: renderMedievalSmithy,
  }),
  makeBuildingDef({
    id: 'medieval-windmill',
    name: 'Ветряная Мельница',
    subtitle: 'Башенная мельница с парусами (56×62)',
    era: 'medieval',
    buildingFunction: 'food',
    kind: 'animated',
    tier: 'II',
    faction: 'Гильдия',
    width: 56,
    height: 62,
    frameCount: 12,
    layersSpec: ['1. Цилиндрическая каменная башня', '2. Конусная крыша и мешки муки', '3. Вращающиеся 4 парусиновых крыла'],
    description: 'Могучая каменная мельница, чьи парусиновые крылья плавно вращаются на ветру, перемалывая зерно.',
    renderReady: renderMedievalWindmill,
  }),
  makeBuildingDef({
    id: 'medieval-church',
    name: 'Церковь и Колокольня',
    subtitle: 'Приходской каменный храм (58×62)',
    era: 'medieval',
    buildingFunction: 'religion',
    kind: 'animated',
    tier: 'III',
    faction: 'Цитадель',
    width: 58,
    height: 62,
    frameCount: 12,
    layersSpec: ['1. Неф с витражами', '2. Высокая колокольня со шпилем', '3. Свечи у портала'],
    description: 'Белокаменная церковь с цветными витражами державы, высокой колокольней и золотым крестом.',
    renderReady: renderMedievalChurch,
  }),
  makeBuildingDef({
    id: 'medieval-castle-walls',
    name: 'Замок и Крепостные Стены',
    subtitle: 'Укреплённый барбакан с воротами (62×54)',
    era: 'medieval',
    buildingFunction: 'defense',
    kind: 'animated',
    tier: 'III',
    faction: 'Цитадель',
    width: 62,
    height: 54,
    frameCount: 12,
    layersSpec: ['1. Парные угловые башни', '2. Зубчатая куртина и герса', '3. Флаги королевства'],
    description: 'Монументальная крепостная стена с двумя дозорными башнями, железной герсой и знамёнами.',
    renderReady: renderMedievalCastleWalls,
  }),
  makeBuildingDef({
    id: 'medieval-archer-tower',
    name: 'Башня Лучников',
    subtitle: 'Стрелковый каменный донжон (50×60)',
    era: 'medieval',
    buildingFunction: 'defense',
    kind: 'animated',
    tier: 'II',
    faction: 'Цитадель',
    width: 50,
    height: 60,
    frameCount: 12,
    layersSpec: ['1. Каменный ствол с бойницами', '2. Навесная деревянная галерея', '3. Шатёр и вымпел'],
    description: 'Стройная оборонительная башня с бойницами и деревянными махикулями для стрелков.',
    renderReady: renderMedievalArcherTower,
  }),
  makeBuildingDef({
    id: 'medieval-barracks',
    name: 'Королевская Казарма',
    subtitle: 'Гарнизонный зал со щитами (58×52)',
    era: 'medieval',
    buildingFunction: 'defense',
    kind: 'animated',
    tier: 'II',
    faction: 'Цитадель',
    width: 58,
    height: 52,
    frameCount: 12,
    layersSpec: ['1. Каменный плац и казарма', '2. Стойки копий и щиты K1/K2', '3. Двойные штандарты'],
    description: 'Крепкая гарнизонная казарма для обучения пехоты и рыцарей, украшенная щитами и штандартами.',
    renderReady: renderMedievalBarracks,
  }),
  makeBuildingDef({
    id: 'medieval-market',
    name: 'Рыночные Ряды',
    subtitle: 'Торговая площадь гильдии (58×48)',
    era: 'medieval',
    buildingFunction: 'production',
    kind: 'animated',
    tier: 'I',
    faction: 'Гильдия',
    width: 58,
    height: 48,
    frameCount: 12,
    layersSpec: ['1. Полосатые тенты лавок', '2. Товары, ткани и бочки', '3. Качающийся фонарь и флаг'],
    description: 'Оживлённый торговый ряд под полосатыми тентами в цветах державы со свитками тканей и бочками.',
    renderReady: renderMedievalMarket,
  }),
  makeBuildingDef({
    id: 'medieval-port',
    name: 'Каменный Порт',
    subtitle: 'Гавань с краном и кораблём (62×52)',
    era: 'medieval',
    buildingFunction: 'production',
    kind: 'animated',
    tier: 'III',
    faction: 'Гильдия',
    width: 62,
    height: 52,
    frameCount: 12,
    layersSpec: ['1. Каменный мол и склад', '2. Портовый деревянный кран', '3. Корабль на волнах гавани'],
    description: 'Мощёная каменная гавань с грузовым краном, складом гильдии и парусным судном на волнах.',
    renderReady: renderMedievalPort,
  }),
];
