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
  drawTimberWall,
} from '../engine/architectureGrammar';
import { RAMPS } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef } from './types';

/**
 * ============================================================================
 * STATIC ARCHITECTURAL MODELS (frameCount = 1, 58x56 .. 62x64 HIGH DENSITY)
 * ============================================================================
 * Built via the multi-stage `buf.layer(...)` sub-assembly grammar:
 * Ground Shadow + Plinth -> Cylindrical/Chamfered Flanking Towers -> Main Keep ->
 * Ambient-Occluded Eaves & Scalloped Roofs -> Portals & Props.
 * ============================================================================
 */

function renderCitadelKeep(): PixelBuffer {
  const buf = new PixelBuffer(58, 60);

  // Layer 0: Wide chamfered slate & marble plinth
  drawGroundPlinth(buf, 29, 52, 22, 5.5, RAMPS.slate, RAMPS.obsidian);

  // Layer 1: Flanking cylindrical bastion turrets with stone belt courses & slit windows
  buf.layer((sub) => {
    drawCylindricalTower(sub, 12, 27, 5, 24, RAMPS.marble, RAMPS.gold);
    drawCrenellations(sub, 7, 25, 11, RAMPS.marble);
    sub.fillRect(11, 33, 2, 4, VOID);
    sub.fillRect(11, 41, 2, 4, VOID);

    drawCylindricalTower(sub, 46, 27, 5, 24, RAMPS.marble, RAMPS.gold);
    drawCrenellations(sub, 41, 25, 11, RAMPS.marble);
    sub.fillRect(45, 33, 2, 4, VOID);
    sub.fillRect(45, 41, 2, 4, VOID);
  });

  // Layer 2: Central Grand Keep masonry body with eave shadow, gold frieze & lancet stained glass
  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 20, 24, 31, RAMPS.marble, 5, true);
    // Gold belt cornice
    sub.fillRect(17, 32, 24, 2, RAMPS.gold.mid);
    sub.fillRect(17, 32, 18, 1, RAMPS.gold.highlight);
    // Flanking K1 stained-glass lancets
    drawGlowingWindow(sub, 19, 24, 3, 5, RAMPS.magenta, RAMPS.gold.shadow);
    drawGlowingWindow(sub, 36, 24, 3, 5, RAMPS.magenta, RAMPS.gold.shadow);
    // Central grand rose medallion
    sub.fillEllipse(29, 26, 4, 4, RAMPS.gold.mid);
    sub.fillEllipse(29, 26, 2.8, 2.8, RAMPS.magenta.mid);
    sub.setPixel(28, 25, RAMPS.magenta.highlight);
    sub.setPixel(29, 26, '#FFFFFF');
  });

  // Layer 3: Twin pointed turret roofs (K1_MASK) with golden finials
  drawShingledRoof(buf, 12, 16, 6, 9, RAMPS.magenta, RAMPS.gold, true);
  drawShingledRoof(buf, 46, 16, 6, 9, RAMPS.magenta, RAMPS.gold, true);

  // Layer 4: Grand central hipped keep roof + golden crown spire & K1 banner
  drawShingledRoof(buf, 29, 8, 14, 13, RAMPS.magenta, RAMPS.gold, true);
  buf.layer((sub) => {
    sub.drawLine(29, 2, 29, 8, RAMPS.gold.highlight);
    sub.fillRect(28, 5, 3, 1, RAMPS.gold.mid);
    sub.fillRect(30, 3, 5, 2, RAMPS.magenta.mid);
    sub.fillRect(30, 3, 2, 1, RAMPS.magenta.highlight);
    sub.fillRect(31, 4, 2, 1, RAMPS.cyanMask.highlight);
  });

  // Layer 5: Arched portcullis gate, stone steps & twin wall braziers
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 51, 5, 11, RAMPS.slate, 'portcullis');
    sub.fillRect(22, 51, 15, 2, RAMPS.marble.mid);
    sub.fillRect(22, 51, 11, 1, RAMPS.marble.highlight);
    sub.fillRect(24, 53, 11, 2, RAMPS.slate.mid);
    drawBrazier(sub, 21, 46, 0.2, RAMPS.lava);
    drawBrazier(sub, 37, 46, 1.8, RAMPS.lava);
  });

  // Layer 6: Hanging heraldic banners (K1 primary + K2 secondary trim)
  buf.layer((sub) => {
    sub.fillRect(10, 37, 4, 8, RAMPS.magenta.mid);
    sub.fillRect(10, 37, 1, 7, RAMPS.magenta.highlight);
    sub.fillRect(11, 39, 2, 3, RAMPS.cyanMask.highlight);
    sub.fillRect(11, 44, 2, 2, RAMPS.magenta.shadow);

    sub.fillRect(44, 37, 4, 8, RAMPS.magenta.shadow);
    sub.fillRect(44, 37, 1, 7, RAMPS.magenta.mid);
    sub.fillRect(45, 39, 2, 3, RAMPS.cyanMask.mid);
    sub.fillRect(45, 44, 2, 2, RAMPS.magenta.deep);
  });

  return buf;
}

function renderBoneOssuary(): PixelBuffer {
  const buf = new PixelBuffer(58, 58);

  // Layer 0: Cracked desert earth plinth with skull accents
  drawGroundPlinth(buf, 29, 50, 22, 5.5, RAMPS.sandstone, RAMPS.timber);

  // Layer 1: Dark necro-slate mausoleum walls with glowing K1 rune frieze
  buf.layer((sub) => {
    drawMasonryBox(sub, 14, 24, 30, 25, RAMPS.slate, 6, true);
    sub.fillRect(14, 24, 30, 2, RAMPS.magenta.shadow);
    sub.fillRect(14, 24, 18, 1, RAMPS.magenta.highlight);
    // Recessed lancet bone vents
    sub.fillRect(17, 30, 2, 6, VOID);
    sub.fillRect(39, 30, 2, 6, VOID);
  });

  // Layer 2: Stepped bone-ribbed dome crowned by giant curved mammoth horns
  buf.layer((sub) => {
    for (let dy = 0; dy < 13; dy++) {
      const span = 6 + Math.round((dy / 12) * 11);
      for (let dx = -span; dx <= span; dx++) {
        const isRib = Math.abs(dx) % 4 === 0;
        const c = isRib
          ? dx < 0
            ? RAMPS.bone.highlight
            : RAMPS.bone.mid
          : dx > span * 0.25
            ? RAMPS.slate.deep
            : RAMPS.slate.shadow;
        sub.setPixel(29 + dx, 12 + dy, c);
      }
    }
    // Giant sweeping upper bone horns & glowing arcane K1 keystone orb
    sub.drawRibArch(21, 16, 15, 7, 23, 3, 2, RAMPS.bone);
    sub.drawRibArch(37, 16, 43, 7, 35, 3, 2, RAMPS.bone);
    sub.fillEllipse(29, 9, 2.5, 2.5, RAMPS.magenta.mid);
    sub.setPixel(28, 8, '#FFFFFF');
  });

  // Layer 3: Sweeping mammoth-rib external flying buttresses
  buf.layer((sub) => {
    sub.drawRibArch(9, 49, 6, 36, 15, 25, 2, RAMPS.bone);
    sub.drawRibArch(11, 49, 9, 38, 16, 29, 2, RAMPS.bone);
    sub.drawRibArch(49, 49, 52, 36, 43, 25, 2, RAMPS.bone);
    sub.drawRibArch(47, 49, 49, 38, 42, 29, 2, RAMPS.bone);
  });

  // Layer 4: Boss horned skull archway portal & stone steps
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 49, 6, 12, RAMPS.bone, 'void');
    sub.drawSkull(29, 31, 'large', RAMPS.magenta.highlight, RAMPS.bone);
    sub.fillRect(23, 49, 13, 2, RAMPS.slate.mid);
  });

  // Layer 5: Crystal druzes, skull piles & mossy base accents
  buf.layer((sub) => {
    sub.drawCrystal(10, 49, 8, -1, 0.85, RAMPS.magenta);
    sub.drawCrystal(48, 49, 8, 1, 0.2, RAMPS.magenta);
    sub.drawSkull(16, 47, 'mini', RAMPS.magenta.mid, RAMPS.bone);
    sub.drawSkull(42, 47, 'mini', RAMPS.magenta.mid, RAMPS.bone);
    sub.fillRect(19, 46, 3, 3, RAMPS.moss.mid);
    sub.setPixel(20, 45, RAMPS.moss.highlight);
    sub.fillRect(36, 46, 3, 3, RAMPS.moss.shadow);
  });

  return buf;
}

function renderDruidShrine(): PixelBuffer {
  const buf = new PixelBuffer(58, 58);

  // Layer 0: Mossy stone terrace plinth with winding entrance steps
  drawGroundPlinth(buf, 29, 50, 22, 5.5, RAMPS.moss, RAMPS.slate);

  // Layer 1: Gnarled ancient oak trunk with flared buttress roots & runic hollow door
  buf.layer((sub) => {
    for (let y = 24; y <= 49; y++) {
      const flare = y > 40 ? Math.round((y - 40) * 1.1) : 0;
      const hw = 11 + flare;
      for (let x = 29 - hw; x <= 29 + hw; x++) {
        const bark = (x * 3 + Math.floor(y / 2)) % 4 === 0;
        const knot = Math.abs(x - 22) <= 1 && y === 34;
        const nx = (x - 29) / hw;
        const c = knot
          ? RAMPS.timber.deep
          : nx > 0.35
            ? RAMPS.timber.deep
            : bark
              ? RAMPS.timber.shadow
              : nx < -0.35
                ? RAMPS.timber.highlight
                : RAMPS.timber.mid;
        sub.setPixel(x, y, c);
      }
    }
    // Glowing hollow sanctuary portal & warm threshold steps
    drawArchedPortal(sub, 29, 49, 5, 11, RAMPS.moss, 'void');
    sub.fillRect(27, 42, 5, 6, RAMPS.magenta.shadow);
    sub.fillRect(28, 43, 3, 4, RAMPS.magenta.mid);
    sub.setPixel(29, 44, '#FFFFFF');
    sub.fillRect(24, 49, 11, 2, RAMPS.slate.mid);
  });

  // Layer 2: Lush 5-lobe ancient canopy with trailing vines & K1 spirit blossoms
  buf.layer((sub) => {
    const lobes = [
      { cx: 15, cy: 25, rx: 9, ry: 7 },
      { cx: 43, cy: 25, rx: 9, ry: 7 },
      { cx: 21, cy: 17, rx: 9.5, ry: 7.5 },
      { cx: 37, cy: 17, rx: 9.5, ry: 7.5 },
      { cx: 29, cy: 12, rx: 11, ry: 8 },
    ];
    for (const lobe of lobes) {
      sub.fillEllipse(lobe.cx, lobe.cy, lobe.rx, lobe.ry, (nx, ny, px, py) => {
        const cluster = (px * 3 + py * 2) % 5 === 0;
        if (ny > 0.45 || nx > 0.48) return RAMPS.moss.deep;
        if (ny < -0.35 && nx < 0.25) return RAMPS.moss.highlight;
        return cluster ? RAMPS.moss.shadow : RAMPS.moss.mid;
      });
    }
    // Trailing moss vines hanging from boughs
    for (const [vx, vy, len] of [
      [11, 31, 6],
      [18, 29, 4],
      [40, 29, 5],
      [46, 31, 6],
    ]) {
      sub.drawLine(vx, vy, vx, vy + len, RAMPS.moss.mid);
      sub.setPixel(vx, vy + len, RAMPS.moss.highlight);
    }
    // Spirit-blossom clusters (K1 + gold nectar cores)
    for (const [bx, by] of [
      [14, 22],
      [22, 13],
      [29, 9],
      [36, 15],
      [43, 22],
      [26, 20],
    ]) {
      sub.fillRect(bx, by, 3, 2, RAMPS.magenta.mid);
      sub.setPixel(bx, by, RAMPS.magenta.highlight);
      sub.setPixel(bx + 1, by + 1, RAMPS.gold.highlight);
    }
  });

  // Layer 3: Standing carved rune monoliths & glowing lantern stone
  buf.layer((sub) => {
    drawMasonryBox(sub, 10, 38, 5, 11, RAMPS.slate, 2);
    sub.fillRect(12, 41, 1, 3, RAMPS.magenta.highlight);
    drawMasonryBox(sub, 43, 38, 5, 11, RAMPS.slate, 2);
    sub.fillRect(45, 41, 1, 3, RAMPS.magenta.highlight);
    drawBrazier(sub, 21, 46, 0.5, RAMPS.magenta);
  });

  return buf;
}

function renderGlacierBastion(): PixelBuffer {
  const buf = new PixelBuffer(58, 60);

  // Layer 0: Packed snow & crystal ice plinth
  drawGroundPlinth(buf, 29, 52, 22, 5.5, RAMPS.ice, RAMPS.slate);

  // Layer 1: Asymmetric jagged ice-crystal side bastions with slit windows
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 27, 10, 24, RAMPS.ice, 3, true);
    sub.drawCrystal(13, 27, 11, -1, 0.9, RAMPS.ice);
    sub.drawCrystal(16, 27, 7, 0, 0.4, RAMPS.ice);
    sub.fillRect(12, 35, 2, 4, VOID);

    drawMasonryBox(sub, 39, 27, 10, 24, RAMPS.ice, 3, true);
    sub.drawCrystal(44, 27, 11, 1, 0.3, RAMPS.ice);
    sub.drawCrystal(41, 27, 7, 0, 0.7, RAMPS.ice);
    sub.fillRect(43, 35, 2, 4, VOID);
  });

  // Layer 2: Central marble-and-frost keep core crowned by massive crystal crown
  buf.layer((sub) => {
    drawMasonryBox(sub, 18, 19, 22, 32, RAMPS.marble, 5, true);
    drawCrenellations(sub, 18, 17, 22, RAMPS.ice);
    // Twin cyan/ice glowing rune slits
    drawGlowingWindow(sub, 20, 24, 2, 5, RAMPS.ice, RAMPS.slate.shadow);
    drawGlowingWindow(sub, 36, 24, 2, 5, RAMPS.ice, RAMPS.slate.shadow);
    // Faceted glacier spire cluster
    sub.drawCrystal(29, 19, 15, 0, 0.95, RAMPS.ice);
    sub.drawCrystal(24, 19, 10, -1, 0.6, RAMPS.ice);
    sub.drawCrystal(34, 19, 10, 1, 0.2, RAMPS.ice);
  });

  // Layer 3: Frost portcullis arch, icicle fringes & radiant K1/K2 keystone
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 51, 5.5, 12, RAMPS.ice, 'portcullis');
    sub.drawCrystal(29, 34, 7, 0, 0.95, RAMPS.magenta);
    sub.fillRect(23, 51, 13, 2, RAMPS.ice.highlight);
    // Hanging icicles along battlement eaves
    for (const [ix, len] of [
      [11, 4],
      [19, 3],
      [25, 4],
      [33, 4],
      [40, 3],
      [47, 4],
    ]) {
      sub.drawLine(ix, 29, ix, 29 + len, RAMPS.ice.highlight);
    }
  });

  return buf;
}

function renderIroncladArmory(): PixelBuffer {
  const buf = new PixelBuffer(58, 56);

  // Layer 0: Cobblestone guild courtyard plinth
  drawGroundPlinth(buf, 29, 48, 22, 5.5, RAMPS.slate, RAMPS.timber);

  // Layer 1: Stone lower smithy base + overhanging half-timbered 2nd story
  buf.layer((sub) => {
    drawMasonryBox(sub, 11, 32, 36, 16, RAMPS.slate, 6, true);
    drawTimberWall(sub, 9, 19, 40, 13, RAMPS.sandstone, RAMPS.timber);
    // Warm glowing leaded guild windows
    drawGlowingWindow(sub, 14, 23, 4, 4, RAMPS.gold, RAMPS.timber.deep);
    drawGlowingWindow(sub, 40, 23, 4, 4, RAMPS.gold, RAMPS.timber.deep);
  });

  // Layer 2: Tall stone chimney with brass flue cap & rising smoke wisps
  buf.layer((sub) => {
    drawMasonryBox(sub, 12, 7, 7, 13, RAMPS.slate, 2);
    sub.fillRect(11, 6, 9, 2, RAMPS.gold.mid);
    sub.fillRect(11, 6, 5, 1, RAMPS.gold.highlight);
  });

  // Layer 3: Steep K1 guild roof + central gabled dormer + striped K1/sail awning
  drawShingledRoof(buf, 29, 6, 21, 14, RAMPS.magenta, RAMPS.gold, false);
  buf.layer((sub) => {
    // Gabled dormer crest
    drawMasonryBox(sub, 25, 12, 8, 7, RAMPS.sandstone, 2);
    sub.fillRect(27, 14, 4, 3, RAMPS.gold.mid);
    // Striped market awning over shop front
    for (let x = 18; x <= 40; x++) {
      const stripe = (x - 18) % 4 < 2;
      sub.fillRect(x, 31, 1, 3, stripe ? RAMPS.sail.highlight : RAMPS.magenta.mid);
      sub.setPixel(x, 34, stripe ? RAMPS.sail.shadow : RAMPS.magenta.deep);
    }
    // Gilded K2 guild plaque above awning
    sub.fillRect(26, 22, 6, 4, RAMPS.gold.mid);
    sub.fillRect(27, 23, 4, 2, RAMPS.cyanMask.highlight);
  });

  // Layer 4: Studded oak workshop door, gunpowder barrels, anvil & cannonball stack
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 48, 5, 10, RAMPS.timber, 'wood');
    sub.fillRect(23, 48, 13, 2, RAMPS.slate.mid);
    // Twin iron-hooped powder kegs on left
    for (const bx of [13, 18]) {
      sub.fillRect(bx, 41, 4, 7, RAMPS.timber.mid);
      sub.fillRect(bx, 42, 4, 1, RAMPS.slate.highlight);
      sub.fillRect(bx, 45, 4, 1, RAMPS.slate.mid);
    }
    // Stacked iron cannonball pyramid & weapon rack on right
    sub.fillRect(38, 45, 7, 3, RAMPS.obsidian.shadow);
    sub.fillRect(39, 43, 5, 2, RAMPS.obsidian.mid);
    sub.fillRect(40, 41, 3, 2, RAMPS.obsidian.highlight);
    // Sword/halberd rack
    sub.drawLine(45, 39, 45, 47, RAMPS.timber.highlight);
    sub.drawLine(44, 38, 46, 38, RAMPS.marble.highlight);
  });

  return buf;
}

function renderObsidianZiggurat(): PixelBuffer {
  const buf = new PixelBuffer(60, 58);

  // Layer 0: Desert sandstone & basalt plinth
  drawGroundPlinth(buf, 30, 50, 23, 5.5, RAMPS.sandstone, RAMPS.timber);

  // Layer 1–4: Four stepped obsidian & gold-trimmed ziggurat tiers
  const tiers = [
    { x: 9, y: 39, w: 42, h: 10 },
    { x: 13, y: 30, w: 34, h: 9 },
    { x: 17, y: 22, w: 26, h: 8 },
    { x: 21, y: 15, w: 18, h: 7 },
  ];
  tiers.forEach((tier, i) => {
    buf.layer((sub) => {
      drawMasonryBox(sub, tier.x, tier.y, tier.w, tier.h, RAMPS.obsidian, 5 - Math.floor(i / 2));
      sub.fillRect(tier.x, tier.y, tier.w, 2, RAMPS.gold.mid);
      sub.fillRect(tier.x, tier.y, Math.round(tier.w * 0.65), 1, RAMPS.gold.highlight);
      // Glowing carved glyph reliefs along terrace face
      for (let gx = tier.x + 3; gx < tier.x + tier.w - 6; gx += 6) {
        sub.setPixel(gx, tier.y + 4, RAMPS.magenta.mid);
      }
    });
  });

  // Layer 5: Grand central ceremonial staircase with gold balustrades & braziers
  buf.layer((sub) => {
    for (let y = 20; y <= 49; y++) {
      const hw = 3 + Math.floor((y - 20) / 8);
      const step = y % 2 === 0;
      sub.fillRect(
        30 - hw,
        y,
        hw * 2 + 1,
        1,
        step ? RAMPS.sandstone.highlight : RAMPS.sandstone.shadow
      );
      sub.fillRect(30 - hw - 1, y, 2, 1, RAMPS.gold.mid);
      sub.fillRect(30 + hw, y, 2, 1, RAMPS.gold.shadow);
    }
    drawBrazier(sub, 20, 46, 0.2, RAMPS.lava);
    drawBrazier(sub, 40, 46, 1.4, RAMPS.lava);
    drawBrazier(sub, 22, 27, 0.9, RAMPS.lava);
    drawBrazier(sub, 38, 27, 2.2, RAMPS.lava);
  });

  // Layer 6: Crowning sun-altar pillars & radiant K1 solar crystal
  buf.layer((sub) => {
    sub.drawCrystal(30, 15, 11, 0, 0.95, RAMPS.magenta);
    sub.drawCrystal(23, 15, 6, -1, 0.5, RAMPS.gold);
    sub.drawCrystal(37, 15, 6, 1, 0.5, RAMPS.gold);
  });

  return buf;
}

function renderGrandCathedral(): PixelBuffer {
  const buf = new PixelBuffer(62, 64);

  // Layer 0: Broad marble sanctuary plinth
  drawGroundPlinth(buf, 31, 56, 24, 5.5, RAMPS.marble, RAMPS.slate);

  // Layer 1: Flying buttresses & side aisles
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 34, 10, 21, RAMPS.marble, 2, true);
    drawMasonryBox(sub, 43, 34, 10, 21, RAMPS.marble, 3, true);
    sub.drawRibArch(11, 34, 12, 26, 17, 24, 2, RAMPS.marble);
    sub.drawRibArch(51, 34, 50, 26, 45, 24, 2, RAMPS.marble);
    drawGlowingWindow(sub, 12, 40, 3, 7, RAMPS.magenta, RAMPS.gold.shadow);
    drawGlowingWindow(sub, 47, 40, 3, 7, RAMPS.magenta, RAMPS.gold.shadow);
  });

  // Layer 2: Twin Gothic Bell Towers with open belfry arches & brass bells
  buf.layer((sub) => {
    drawMasonryBox(sub, 15, 19, 9, 36, RAMPS.marble, 2);
    drawMasonryBox(sub, 38, 19, 9, 36, RAMPS.marble, 3);
    // Open belfry windows with hanging gold bells
    sub.fillRect(17, 22, 4, 5, VOID);
    sub.fillRect(18, 23, 2, 3, RAMPS.gold.highlight);
    sub.fillRect(40, 22, 4, 5, VOID);
    sub.fillRect(41, 23, 2, 3, RAMPS.gold.highlight);
  });
  drawShingledRoof(buf, 19, 6, 5, 13, RAMPS.magenta, RAMPS.gold, true);
  drawShingledRoof(buf, 42, 6, 5, 13, RAMPS.magenta, RAMPS.gold, true);

  // Layer 3: Soaring central cathedral nave, gable & giant rose stained-glass window
  buf.layer((sub) => {
    drawMasonryBox(sub, 22, 23, 18, 32, RAMPS.marble, 4, true);
    drawShingledRoof(sub, 31, 13, 10, 10, RAMPS.magenta, RAMPS.gold);
    // Giant stained-glass rose window
    sub.fillEllipse(31, 31, 5, 5, RAMPS.gold.mid);
    sub.fillEllipse(31, 31, 3.6, 3.6, RAMPS.magenta.mid);
    sub.setPixel(30, 30, RAMPS.cyanMask.highlight);
    sub.setPixel(32, 30, RAMPS.cyanMask.highlight);
    sub.setPixel(31, 31, '#FFFFFF');
  });

  // Layer 4: Twin golden cross spires + arched cathedral portal & steps
  buf.layer((sub) => {
    sub.drawLine(19, 2, 19, 6, RAMPS.gold.highlight);
    sub.fillRect(18, 3, 3, 1, RAMPS.gold.mid);
    sub.drawLine(42, 2, 42, 6, RAMPS.gold.highlight);
    sub.fillRect(41, 3, 3, 1, RAMPS.gold.mid);

    drawArchedPortal(sub, 31, 55, 5.5, 12, RAMPS.gold, 'wood');
    sub.fillRect(24, 55, 15, 2, RAMPS.marble.highlight);
    sub.fillRect(25, 57, 13, 2, RAMPS.slate.mid);
    drawBrazier(sub, 23, 50, 0.3, RAMPS.lava);
    drawBrazier(sub, 39, 50, 1.4, RAMPS.lava);
  });

  return buf;
}

function renderHarborBastion(): PixelBuffer {
  const buf = new PixelBuffer(60, 60);

  // Layer 0: Stone seawall & timber wharf foundation
  drawGroundPlinth(buf, 30, 52, 23, 5.5, RAMPS.slate, RAMPS.timber);

  // Layer 1: Fortified sea-gate warehouse & timber wharf deck on right
  buf.layer((sub) => {
    drawMasonryBox(sub, 22, 29, 26, 22, RAMPS.slate, 5, true);
    drawTimberWall(sub, 21, 22, 28, 8, RAMPS.sandstone, RAMPS.timber);
    drawGlowingWindow(sub, 38, 24, 4, 3, RAMPS.gold, RAMPS.timber.deep);
    drawArchedPortal(sub, 32, 51, 5, 11, RAMPS.slate, 'portcullis');
  });
  drawShingledRoof(buf, 35, 13, 14, 9, RAMPS.magenta, RAMPS.gold);

  // Layer 2: Towering harbor lighthouse bastion on left
  buf.layer((sub) => {
    drawCylindricalTower(sub, 15, 16, 6, 35, RAMPS.marble, RAMPS.magenta);
    sub.fillRect(14, 26, 2, 4, VOID);
    sub.fillRect(14, 37, 2, 4, VOID);
    // Open stone beacon gallery & roaring harbor fire
    sub.fillRect(9, 13, 12, 3, RAMPS.slate.mid);
    sub.fillRect(11, 7, 8, 6, RAMPS.gold.mid);
    sub.fillRect(12, 8, 6, 4, RAMPS.lava.highlight);
    sub.fillRect(14, 9, 2, 2, '#FFFFFF');
  });
  drawShingledRoof(buf, 15, 2, 6, 6, RAMPS.magenta, RAMPS.gold);

  // Layer 3: Wharf cargo crates, crane hook & K1/K2 guild pennant
  buf.layer((sub) => {
    // Timber cargo crates stacked on right wharf
    sub.fillRect(42, 45, 6, 6, RAMPS.timber.mid);
    sub.fillRect(42, 45, 5, 1, RAMPS.timber.highlight);
    sub.drawLine(42, 45, 47, 50, RAMPS.timber.deep);
    sub.fillRect(45, 40, 5, 5, RAMPS.timber.highlight);
    sub.drawLine(45, 40, 49, 44, RAMPS.timber.shadow);
    // K1/K2 sea banner
    sub.drawLine(35, 6, 35, 13, RAMPS.bone.highlight);
    sub.fillRect(36, 7, 6, 3, RAMPS.magenta.mid);
    sub.fillRect(37, 8, 2, 1, RAMPS.cyanMask.highlight);
  });

  return buf;
}

function renderWatchtowerT1(): PixelBuffer {
  const buf = new PixelBuffer(56, 58);

  // Layer 0: Timber & stone patrol plinth
  drawGroundPlinth(buf, 28, 50, 19, 5, RAMPS.sandstone, RAMPS.timber);

  // Layer 1: Tapered stone base + timber strut braces
  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 29, 22, 21, RAMPS.slate, 5, true);
    drawArchedPortal(sub, 28, 50, 4, 8, RAMPS.timber, 'wood');
    // Diagonal timber supports for overhang gallery
    sub.drawLine(14, 29, 17, 34, RAMPS.timber.highlight, 2);
    sub.drawLine(41, 29, 38, 34, RAMPS.timber.deep, 2);
  });

  // Layer 2: Overhanging timber watch gallery with arrow slits & lantern
  buf.layer((sub) => {
    drawTimberWall(sub, 13, 18, 30, 11, RAMPS.sandstone, RAMPS.timber);
    drawCrenellations(sub, 13, 16, 30, RAMPS.timber);
    drawGlowingWindow(sub, 18, 22, 3, 4, RAMPS.gold, RAMPS.timber.deep);
    drawGlowingWindow(sub, 34, 22, 3, 4, RAMPS.gold, RAMPS.timber.deep);
    // Hanging brass alarm bell in center niche
    sub.fillRect(26, 20, 4, 5, VOID);
    sub.fillRect(27, 21, 2, 3, RAMPS.gold.highlight);
    sub.setPixel(28, 24, RAMPS.gold.mid);
    // Brazier on front post
    drawBrazier(sub, 18, 44, 0.4, RAMPS.lava);
  });

  // Layer 3: Pointed K1 shingled watch roof + golden finial & K1/K2 pennant
  drawShingledRoof(buf, 28, 7, 16, 10, RAMPS.magenta, RAMPS.gold, true);
  buf.layer((sub) => {
    sub.drawLine(28, 2, 28, 8, RAMPS.gold.highlight);
    sub.fillRect(29, 3, 6, 3, RAMPS.magenta.mid);
    sub.fillRect(29, 3, 3, 1, RAMPS.magenta.highlight);
    sub.fillRect(31, 4, 2, 1, RAMPS.cyanMask.highlight);
  });

  return buf;
}

function renderNecroCitadelT3(): PixelBuffer {
  const buf = new PixelBuffer(64, 64);

  // Layer 0: Obsidian & desert earth foundation
  drawGroundPlinth(buf, 32, 56, 25, 5.5, RAMPS.obsidian, RAMPS.slate);

  // Layer 1: Flanking rib-armored necro-slate towers with bone spires
  buf.layer((sub) => {
    drawCylindricalTower(sub, 12, 24, 5, 31, RAMPS.slate, RAMPS.bone);
    drawCylindricalTower(sub, 52, 24, 5, 31, RAMPS.slate, RAMPS.bone);
    sub.drawCrystal(12, 23, 9, 0, 0.9, RAMPS.magenta);
    sub.drawCrystal(52, 23, 9, 0, 0.9, RAMPS.magenta);
    sub.drawRibArch(8, 53, 5, 40, 12, 28, 2, RAMPS.bone);
    sub.drawRibArch(56, 53, 59, 40, 52, 28, 2, RAMPS.bone);
  });

  // Layer 2: Central stepped obsidian citadel with K1 soul-well windows & K2 rune frieze
  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 22, 30, 33, RAMPS.obsidian, 6, true);
    sub.fillRect(17, 22, 30, 2, RAMPS.cyanMask.mid);
    sub.fillRect(17, 22, 20, 1, RAMPS.cyanMask.highlight);
    drawGlowingWindow(sub, 20, 27, 3, 6, RAMPS.magenta, RAMPS.bone.shadow);
    drawGlowingWindow(sub, 41, 27, 3, 6, RAMPS.magenta, RAMPS.bone.shadow);
    // Upper bone crown spire
    drawMasonryBox(sub, 23, 12, 18, 11, RAMPS.slate, 4, true);
    sub.drawSkull(32, 17, 'mini', RAMPS.cyanMask.highlight, RAMPS.bone);
  });

  // Layer 3: Horned bone roof + giant K1 crystal spire
  buf.layer((sub) => {
    sub.drawRibArch(21, 13, 19, 5, 27, 2, 2, RAMPS.bone);
    sub.drawRibArch(43, 13, 45, 5, 37, 2, 2, RAMPS.bone);
    sub.drawCrystal(32, 12, 10, 0, 1, RAMPS.magenta);
  });

  // Layer 4: Grand skull gatehouse, soul-flame brazier plinths & banners
  buf.layer((sub) => {
    drawArchedPortal(sub, 32, 55, 6, 13, RAMPS.bone, 'void');
    sub.drawSkull(32, 39, 'large', RAMPS.magenta.highlight, RAMPS.bone);
    drawBrazier(sub, 22, 50, 0.5, RAMPS.cyanMask);
    drawBrazier(sub, 42, 50, 1.4, RAMPS.cyanMask);
    // K1/K2 side banners
    sub.fillRect(10, 34, 4, 9, RAMPS.magenta.mid);
    sub.fillRect(11, 36, 2, 3, RAMPS.cyanMask.highlight);
    sub.fillRect(50, 34, 4, 9, RAMPS.magenta.shadow);
    sub.fillRect(51, 36, 2, 3, RAMPS.cyanMask.mid);
  });

  return buf;
}

function renderElderGroveT3(): PixelBuffer {
  const buf = new PixelBuffer(64, 64);

  // Layer 0: Lush mossy hillock & stone terrace plinth
  drawGroundPlinth(buf, 32, 56, 24, 5.5, RAMPS.moss, RAMPS.sandstone);

  // Layer 1: Colossal gnarled oak trunk with flared roots & waterfall spring
  buf.layer((sub) => {
    for (let y = 26; y <= 55; y++) {
      const p = (y - 26) / 29;
      const hw = Math.round(9 + p * p * 11);
      for (let x = 32 - hw; x <= 32 + hw; x++) {
        const nx = (x - 32) / hw;
        const bark = (x + y * 2) % 4 === 0;
        sub.setPixel(
          x,
          y,
          nx < -0.35
            ? RAMPS.timber.highlight
            : nx > 0.35 || bark
              ? RAMPS.timber.deep
              : RAMPS.timber.mid
        );
      }
    }
    // Luminous portal arch & stone steps
    drawArchedPortal(sub, 32, 55, 5, 11, RAMPS.marble, 'void');
    sub.fillEllipse(32, 49, 3, 4.5, RAMPS.magenta.mid);
    sub.setPixel(31, 47, '#FFFFFF');
    // Flanking mossy rune obelisks with K2 crystals
    drawMasonryBox(sub, 10, 41, 6, 13, RAMPS.slate, 2);
    sub.fillRect(12, 43, 2, 5, RAMPS.cyanMask.highlight);
    drawMasonryBox(sub, 48, 41, 6, 13, RAMPS.slate, 2);
    sub.fillRect(50, 43, 2, 5, RAMPS.cyanMask.mid);
  });

  // Layer 2: Multi-lobed grand ancient canopy with K1 spirit blossoms & amber lantern pods
  buf.layer((canopy) => {
    const lobes = [
      { cx: 18, cy: 23, rx: 11, ry: 9 },
      { cx: 46, cy: 23, rx: 11, ry: 9 },
      { cx: 24, cy: 14, rx: 12, ry: 10 },
      { cx: 40, cy: 15, rx: 12, ry: 10 },
      { cx: 32, cy: 18, rx: 15, ry: 11 },
    ];
    for (const l of lobes) {
      canopy.fillEllipse(l.cx, l.cy, l.rx, l.ry, (nx, ny, px, py) => {
        const leaf = (px * 5 + py * 3) % 7 === 0;
        if (ny > 0.45 || nx > 0.45) return RAMPS.moss.deep;
        if (ny < -0.3 && nx < 0.25) return RAMPS.moss.highlight;
        return leaf ? RAMPS.moss.shadow : RAMPS.moss.mid;
      });
    }
    // Hanging vines & golden blossom lantern pods
    for (const vx of [15, 22, 42, 49]) {
      canopy.drawLine(vx, 30, vx, 36, RAMPS.moss.shadow);
      canopy.fillRect(vx - 1, 36, 3, 3, RAMPS.gold.mid);
      canopy.setPixel(vx, 37, RAMPS.gold.highlight);
    }
    // K1 glowing blossoms in canopy
    for (const [bx, by] of [
      [20, 14],
      [28, 10],
      [37, 11],
      [45, 20],
      [16, 23],
      [32, 20],
    ]) {
      canopy.fillRect(bx, by, 2, 2, RAMPS.magenta.highlight);
      canopy.setPixel(bx + 1, by + 1, RAMPS.cyanMask.highlight);
    }
  });

  return buf;
}

function renderOrcWarCampT1(): PixelBuffer {
  const buf = new PixelBuffer(58, 58);

  // Layer 0: Packed dirt & red rock war-camp plinth
  drawGroundPlinth(buf, 29, 50, 22, 5.5, RAMPS.sandstone, RAMPS.timber);

  // Layer 1: Spiked wooden palisade wall with iron bindings
  buf.layer((sub) => {
    for (let px = 8; px <= 49; px += 3) {
      const h = px >= 22 && px <= 35 ? 10 : 16;
      const topY = 47 - h;
      sub.fillRect(px, topY, 3, h, px > 32 ? RAMPS.timber.shadow : RAMPS.timber.mid);
      sub.setPixel(px + 1, topY - 1, RAMPS.timber.highlight);
      sub.setPixel(px + 1, topY - 2, RAMPS.bone.highlight);
    }
    sub.fillRect(8, 39, 43, 2, RAMPS.obsidian.mid);
    sub.fillRect(8, 44, 43, 2, RAMPS.obsidian.shadow);
  });

  // Layer 2: Giant horned war-tent (K1 hide + K2 warpaint)
  buf.layer((sub) => {
    for (let dy = 0; dy < 24; dy++) {
      const hw = Math.round(3 + (dy / 23) * 14);
      for (let dx = -hw; dx <= hw; dx++) {
        const nx = dx / (hw || 1);
        const stripe = dy >= 10 && dy <= 13;
        const c = stripe
          ? nx > 0.35
            ? RAMPS.cyanMask.shadow
            : RAMPS.cyanMask.highlight
          : nx < -0.3
            ? RAMPS.magenta.highlight
            : nx > 0.35
              ? RAMPS.magenta.shadow
              : RAMPS.magenta.mid;
        sub.setPixel(29 + dx, 14 + dy, c);
      }
    }
    // Dark doorway slit & curved tusk poles
    sub.fillRect(26, 28, 6, 10, VOID);
    sub.drawRibArch(26, 16, 17, 12, 16, 6, 2, RAMPS.bone);
    sub.drawRibArch(32, 16, 41, 12, 42, 6, 2, RAMPS.bone);
  });

  // Layer 3: Totem skulls + central campfire hearth
  buf.layer((sub) => {
    sub.drawSkull(12, 34, 'mini', RAMPS.lava.highlight, RAMPS.bone);
    sub.drawSkull(46, 34, 'mini', RAMPS.lava.highlight, RAMPS.bone);
    drawBrazier(sub, 29, 49, 0.7, RAMPS.lava);
    // Weapon rack on left
    sub.drawLine(16, 48, 20, 41, RAMPS.slate.highlight);
    sub.fillRect(19, 41, 2, 2, RAMPS.slate.mid);
  });

  return buf;
}

export const STATIC_MODELS: PixelModelDef[] = [
  {
    id: 'citadel-keep',
    name: 'Цитадель Рассвета',
    subtitle: 'Высокодетализированная крепость (58×60)',
    kind: 'static',
    tier: 'II',
    faction: 'Цитадель',
    width: 58,
    height: 60,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Отбрасываемая тень + широкий каменный цоколь',
      '1. Боковые цилиндрические башни с золотыми поясами и зубцами',
      '2. Мраморный донжон с карнизом, витражами и розой-окном',
      '3. Вогнутая черепичная крыша (K1) со шпилем и флагом (K2)',
      '4. Арочные ворота с решёткой, ступенями, жаровнями и знамёнами',
    ],
    description:
      'Эталонная статичная крепость RTS повышенной плотности: цилиндрические башни, затемнение под свесами крыши, витражные окна и двухканальные знамёна K1/K2.',
    renderFrame: () => renderCitadelKeep(),
    codeSnippet: `function renderCitadelKeep(): PixelBuffer {
  const buf = new PixelBuffer(58, 60);
  drawGroundPlinth(buf, 29, 52, 22, 5.5, RAMPS.slate, RAMPS.obsidian);

  buf.layer((sub) => {
    drawCylindricalTower(sub, 12, 27, 5, 24, RAMPS.marble, RAMPS.gold);
    drawCrenellations(sub, 7, 25, 11, RAMPS.marble);
    drawCylindricalTower(sub, 46, 27, 5, 24, RAMPS.marble, RAMPS.gold);
    drawCrenellations(sub, 41, 25, 11, RAMPS.marble);
  });

  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 20, 24, 31, RAMPS.marble, 5, true);
    drawGlowingWindow(sub, 19, 24, 3, 5, RAMPS.magenta, RAMPS.gold.shadow);
    drawGlowingWindow(sub, 36, 24, 3, 5, RAMPS.magenta, RAMPS.gold.shadow);
    sub.fillEllipse(29, 26, 4, 4, RAMPS.gold.mid);
    sub.fillEllipse(29, 26, 2.8, 2.8, RAMPS.magenta.mid);
  });

  drawShingledRoof(buf, 12, 16, 6, 9, RAMPS.magenta, RAMPS.gold, true);
  drawShingledRoof(buf, 46, 16, 6, 9, RAMPS.magenta, RAMPS.gold, true);
  drawShingledRoof(buf, 29, 8, 14, 13, RAMPS.magenta, RAMPS.gold, true);

  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 51, 5, 11, RAMPS.slate, 'portcullis');
    drawBrazier(sub, 21, 46, 0.2, RAMPS.lava);
    drawBrazier(sub, 37, 46, 1.8, RAMPS.lava);
  });
  return buf;
}`,
  },
  {
    id: 'bone-ossuary',
    name: 'Костяная Оссуария',
    subtitle: 'Мавзолей некрополиса с рёбрами (58×58)',
    kind: 'static',
    tier: 'II',
    faction: 'Некрополь',
    width: 58,
    height: 58,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Земляной цоколь с отбрасываемой тенью',
      '1. Сланцевый склеп с руническим фризом K1 и бойницами',
      '2. Ступенчатый костяной свод с огромными рогами и сферой',
      '3. Двойные рёберные контрфорсы по бокам фасада',
      '4. Врата-череп со ступенями, мхом и друзами кристаллов',
    ],
    description:
      'Тёмнофэнтезийный склеп с многорядными контрфорсами из мамонтовых рёбер, рогатым куполом, светящимися глазницами портала и порослью мха.',
    renderFrame: () => renderBoneOssuary(),
    codeSnippet: `function renderBoneOssuary(): PixelBuffer {
  const buf = new PixelBuffer(58, 58);
  drawGroundPlinth(buf, 29, 50, 22, 5.5, RAMPS.sandstone, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 14, 24, 30, 25, RAMPS.slate, 6, true);
    sub.fillRect(14, 24, 30, 2, RAMPS.magenta.shadow);
  });
  buf.layer((sub) => {
    sub.drawRibArch(21, 16, 15, 7, 23, 3, 2, RAMPS.bone);
    sub.drawRibArch(37, 16, 43, 7, 35, 3, 2, RAMPS.bone);
    sub.drawRibArch(9, 49, 6, 36, 15, 25, 2, RAMPS.bone);
    sub.drawRibArch(49, 49, 52, 36, 43, 25, 2, RAMPS.bone);
  });
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 49, 6, 12, RAMPS.bone, 'void');
    sub.drawSkull(29, 31, 'large', RAMPS.magenta.highlight, RAMPS.bone);
    sub.drawCrystal(10, 49, 8, -1, 0.85, RAMPS.magenta);
    sub.drawCrystal(48, 49, 8, 1, 0.2, RAMPS.magenta);
  });
  return buf;
}`,
  },
  {
    id: 'druid-shrine',
    name: 'Лесная Часовня',
    subtitle: 'Священный дуб друидов (58×58)',
    kind: 'static',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 58,
    height: 58,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Мшистый каменный подиум с тенью',
      '1. Узловатый ствол с корнями, дуплом-вратами и ступенями',
      '2. Пятидольная пышная крона со свисающими лианами и цветами',
      '3. Рунные обелиски и светящийся алтарный огонь',
    ],
    description:
      'Пятидольная крона древнего дуба с объёмной тенью под листвой, свисающими лианами, корнями у каменных ступеней и рунными стелами.',
    renderFrame: () => renderDruidShrine(),
    codeSnippet: `function renderDruidShrine(): PixelBuffer {
  const buf = new PixelBuffer(58, 58);
  drawGroundPlinth(buf, 29, 50, 22, 5.5, RAMPS.moss, RAMPS.slate);
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 49, 5, 11, RAMPS.moss, 'void');
    sub.fillRect(27, 42, 5, 6, RAMPS.magenta.shadow);
  });
  buf.layer((sub) => {
    const lobes = [
      { cx: 15, cy: 25, rx: 9, ry: 7 },
      { cx: 43, cy: 25, rx: 9, ry: 7 },
      { cx: 29, cy: 12, rx: 11, ry: 8 },
    ];
    for (const l of lobes) {
      sub.fillEllipse(l.cx, l.cy, l.rx, l.ry, (nx, ny) =>
        ny > 0.45 ? RAMPS.moss.deep : ny < -0.35 ? RAMPS.moss.highlight : RAMPS.moss.mid
      );
    }
  });
  return buf;
}`,
  },
  {
    id: 'glacier-bastion',
    name: 'Цитадель Мороза',
    subtitle: 'Ледяной бастион с кристаллами (58×60)',
    kind: 'static',
    tier: 'II',
    faction: 'Бастион Мороза',
    width: 58,
    height: 60,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Снежно-ледяной цоколь',
      '1. Боковые ледяные бастионы со шпилями и бойницами',
      '2. Центральная мраморная башня с зубцами и короной изо льда',
      '3. Ледяная решётка, сосульки под карнизом и кристалл K1',
    ],
    description:
      'Многогранные кристаллы льда на боковых пилонах и венце главной башни, сосульки под свесами и светящийся рунный ключ портала.',
    renderFrame: () => renderGlacierBastion(),
    codeSnippet: `function renderGlacierBastion(): PixelBuffer {
  const buf = new PixelBuffer(58, 60);
  drawGroundPlinth(buf, 29, 52, 22, 5.5, RAMPS.ice, RAMPS.slate);
  buf.layer((sub) => {
    drawMasonryBox(sub, 9, 27, 10, 24, RAMPS.ice, 3, true);
    sub.drawCrystal(13, 27, 11, -1, 0.9, RAMPS.ice);
    drawMasonryBox(sub, 39, 27, 10, 24, RAMPS.ice, 3, true);
    sub.drawCrystal(44, 27, 11, 1, 0.3, RAMPS.ice);
  });
  buf.layer((sub) => {
    drawMasonryBox(sub, 18, 19, 22, 32, RAMPS.marble, 5, true);
    sub.drawCrystal(29, 19, 15, 0, 0.95, RAMPS.ice);
    drawArchedPortal(sub, 29, 51, 5.5, 12, RAMPS.ice, 'portcullis');
    sub.drawCrystal(29, 34, 7, 0, 0.95, RAMPS.magenta);
  });
  return buf;
}`,
  },
  {
    id: 'ironclad-armory',
    name: 'Оружейная Гильдии',
    subtitle: 'Фахверковая кузня-мастерская (58×56)',
    kind: 'static',
    tier: 'I',
    faction: 'Гильдия',
    width: 58,
    height: 56,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Мощёный булыжником фундамент',
      '1. Каменный цоколь и нависающий фахверк с диагоналями',
      '2. Каменная труба с латунным колпаком',
      '3. Крыша со слуховым окном, тент K1 и табличка K2',
      '4. Бочки, пирамида ядер и оружейная стойка у входа',
    ],
    description:
      'Постройка гильдии с диагональными балками фахверка, слуховым окном на черепичном скате, полосатым тентом и детальным реквизитом у порога.',
    renderFrame: () => renderIroncladArmory(),
    codeSnippet: `function renderIroncladArmory(): PixelBuffer {
  const buf = new PixelBuffer(58, 56);
  drawGroundPlinth(buf, 29, 48, 22, 5.5, RAMPS.slate, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 11, 32, 36, 16, RAMPS.slate, 6, true);
    drawTimberWall(sub, 9, 19, 40, 13, RAMPS.sandstone, RAMPS.timber);
    drawGlowingWindow(sub, 14, 23, 4, 4, RAMPS.gold, RAMPS.timber.deep);
  });
  drawShingledRoof(buf, 29, 6, 21, 14, RAMPS.magenta, RAMPS.gold);
  buf.layer((sub) => {
    drawArchedPortal(sub, 29, 48, 5, 10, RAMPS.timber, 'wood');
    sub.fillRect(38, 45, 7, 3, RAMPS.obsidian.shadow);
    sub.fillRect(39, 43, 5, 2, RAMPS.obsidian.mid);
  });
  return buf;
}`,
  },
  {
    id: 'obsidian-ziggurat',
    name: 'Храм Солнца',
    subtitle: 'Четырёхъярусный зиккурат (60×58)',
    kind: 'static',
    tier: 'II',
    faction: 'Кузня Пекла',
    width: 60,
    height: 58,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Песчаный постамент с отбрасываемой тенью',
      '1. Четыре обсидиановых яруса с золотыми карнизами и глифами',
      '2. Церемониальная лестница с четырьмя жаровнями',
      '3. Алтарный обелиск с тройным кристаллом',
    ],
    description:
      'Монументальный 4-ярусный зиккурат с резными глифами на террасах, золотыми перилами лестницы, четырьмя жаровнями и тройным алтарём.',
    renderFrame: () => renderObsidianZiggurat(),
    codeSnippet: `function renderObsidianZiggurat(): PixelBuffer {
  const buf = new PixelBuffer(60, 58);
  drawGroundPlinth(buf, 30, 50, 23, 5.5, RAMPS.sandstone, RAMPS.timber);
  for (const tier of [
    { x: 9, y: 39, w: 42, h: 10 },
    { x: 13, y: 30, w: 34, h: 9 },
    { x: 17, y: 22, w: 26, h: 8 },
    { x: 21, y: 15, w: 18, h: 7 },
  ]) {
    buf.layer((sub) => {
      drawMasonryBox(sub, tier.x, tier.y, tier.w, tier.h, RAMPS.obsidian, 4);
      sub.fillRect(tier.x, tier.y, tier.w, 2, RAMPS.gold.mid);
    });
  }
  buf.layer((sub) => sub.drawCrystal(30, 15, 11, 0, 0.95, RAMPS.magenta));
  return buf;
}`,
  },
  {
    id: 'grand-cathedral',
    name: 'Собор Света',
    subtitle: 'Готический собор с колокольнями (62×64)',
    kind: 'static',
    tier: 'III',
    faction: 'Цитадель',
    width: 62,
    height: 64,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Широкий мраморный стилобат',
      '1. Аркбутаны и боковые нефы с витражами',
      '2. Две колокольни с открытыми арками и золотыми колоколами',
      '3. Центральный неф, окно-роза (K1+K2) и портал со ступенями',
    ],
    description:
      'Новая крупная постройка 62×64: аркбутаны, двойные звонницы с золотыми колоколами внутри арок, витражная роза и торжественные врата.',
    renderFrame: () => renderGrandCathedral(),
    codeSnippet: `function renderGrandCathedral(): PixelBuffer {
  const buf = new PixelBuffer(62, 64);
  drawGroundPlinth(buf, 31, 56, 24, 5.5, RAMPS.marble, RAMPS.slate);
  buf.layer((sub) => {
    drawMasonryBox(sub, 15, 19, 9, 36, RAMPS.marble, 2);
    drawMasonryBox(sub, 38, 19, 9, 36, RAMPS.marble, 3);
    sub.fillRect(17, 22, 4, 5, VOID);
    sub.fillRect(18, 23, 2, 3, RAMPS.gold.highlight);
  });
  drawShingledRoof(buf, 19, 6, 5, 13, RAMPS.magenta, RAMPS.gold, true);
  drawShingledRoof(buf, 42, 6, 5, 13, RAMPS.magenta, RAMPS.gold, true);
  buf.layer((sub) => {
    drawMasonryBox(sub, 22, 23, 18, 32, RAMPS.marble, 4, true);
    sub.fillEllipse(31, 31, 5, 5, RAMPS.gold.mid);
    sub.fillEllipse(31, 31, 3.6, 3.6, RAMPS.magenta.mid);
    drawArchedPortal(sub, 31, 55, 5.5, 12, RAMPS.gold, 'wood');
  });
  return buf;
}`,
  },
  {
    id: 'harbor-bastion',
    name: 'Бастион Гавани',
    subtitle: 'Морской форт и маяк причала (60×60)',
    kind: 'static',
    tier: 'II',
    faction: 'Гильдия',
    width: 60,
    height: 60,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Причальный фундамент',
      '1. Морские ворота с решёткой и фахверковым складом',
      '2. Цилиндрическая башня маяка с пылающим фонарём',
      '3. Штабель ящиков и штандарт гильдии K1/K2',
    ],
    description:
      'Новый портовый форт-маяк: соединяет укреплённый склад с решёткой морских ворот, высокую башню маяка и грузовые ящики на пристани.',
    renderFrame: () => renderHarborBastion(),
    codeSnippet: `function renderHarborBastion(): PixelBuffer {
  const buf = new PixelBuffer(60, 60);
  drawGroundPlinth(buf, 30, 52, 23, 5.5, RAMPS.slate, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 22, 29, 26, 22, RAMPS.slate, 5, true);
    drawTimberWall(sub, 21, 22, 28, 8, RAMPS.sandstone, RAMPS.timber);
    drawArchedPortal(sub, 32, 51, 5, 11, RAMPS.slate, 'portcullis');
  });
  buf.layer((sub) => {
    drawCylindricalTower(sub, 15, 16, 6, 35, RAMPS.marble, RAMPS.magenta);
    sub.fillRect(11, 7, 8, 6, RAMPS.gold.mid);
    sub.fillRect(12, 8, 6, 4, RAMPS.lava.highlight);
  });
  drawShingledRoof(buf, 15, 2, 6, 6, RAMPS.magenta, RAMPS.gold);
  return buf;
}`,
  },
  {
    id: 'watchtower-t1',
    name: 'Дозорная Башня',
    subtitle: 'Базовый форпост с набатным колоколом (56×58)',
    kind: 'static',
    tier: 'I',
    faction: 'Цитадель',
    width: 56,
    height: 58,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Патрульный цоколь с падающей тенью',
      '1. Каменный нижний ярус с подкосами галереи',
      '2. Навесная фахверковая галерея, бойницы и латунный колокол',
      '3. Шатровая крыша (K1) и дозорный вымпел (K2)',
    ],
    description:
      'Постройка уровня I: укреплённый сторожевой пункт с деревянными подкосами, набатным колоколом в нише и факелом у порога.',
    renderFrame: () => renderWatchtowerT1(),
    codeSnippet: `function renderWatchtowerT1(): PixelBuffer {
  const buf = new PixelBuffer(56, 58);
  drawGroundPlinth(buf, 28, 50, 19, 5, RAMPS.sandstone, RAMPS.timber);
  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 29, 22, 21, RAMPS.slate, 5, true);
    drawArchedPortal(sub, 28, 50, 4, 8, RAMPS.timber, 'wood');
  });
  buf.layer((sub) => {
    drawTimberWall(sub, 13, 18, 30, 11, RAMPS.sandstone, RAMPS.timber);
    drawCrenellations(sub, 13, 16, 30, RAMPS.timber);
  });
  drawShingledRoof(buf, 28, 7, 16, 10, RAMPS.magenta, RAMPS.gold, true);
  return buf;
}`,
  },
  {
    id: 'necro-citadel-t3',
    name: 'Некрополь Вечности',
    subtitle: 'Великая цитадель нежити (64×64)',
    kind: 'static',
    tier: 'III',
    faction: 'Некрополь',
    width: 64,
    height: 64,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Базальтово-обсидиановый цоколь',
      '1. Две боковые башни с рёбрами и кристаллами душ (K1)',
      '2. Трёхъярусный обсидиановый донжон с поясом K2',
      '3. Рогатый костяной венец, череп врат и жаровни пламени душ',
    ],
    description:
      'Постройка уровня III для Некрополя: монументальная 64×64 крепость с рогатым венцом, двойными костяными аркбутанами и бирюзовыми жаровнями.',
    renderFrame: () => renderNecroCitadelT3(),
    codeSnippet: `function renderNecroCitadelT3(): PixelBuffer {
  const buf = new PixelBuffer(64, 64);
  drawGroundPlinth(buf, 32, 56, 25, 5.5, RAMPS.obsidian, RAMPS.slate);
  buf.layer((sub) => {
    drawCylindricalTower(sub, 12, 24, 5, 31, RAMPS.slate, RAMPS.bone);
    drawCylindricalTower(sub, 52, 24, 5, 31, RAMPS.slate, RAMPS.bone);
  });
  buf.layer((sub) => {
    drawMasonryBox(sub, 17, 22, 30, 33, RAMPS.obsidian, 6, true);
    sub.drawSkull(32, 39, 'large', RAMPS.magenta.highlight, RAMPS.bone);
  });
  return buf;
}`,
  },
  {
    id: 'elder-grove-t3',
    name: 'Древо Жизни',
    subtitle: 'Древний оплот Лесного Круга (64×64)',
    kind: 'static',
    tier: 'III',
    faction: 'Лесной Круг',
    width: 64,
    height: 64,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Моховой холм с каменными рунными стелами',
      '1. Могучий узловатый ствол с мраморной аркой истока',
      '2. Пятидольная крона с цветами духа (K1/K2) и золотыми плодами',
    ],
    description:
      'Элитное святилище уровня III: колоссальный священный дуб 64×64 с рунными обелисками, светящимся истоком в стволе и подвесными фонарями-бутонами.',
    renderFrame: () => renderElderGroveT3(),
    codeSnippet: `function renderElderGroveT3(): PixelBuffer {
  const buf = new PixelBuffer(64, 64);
  drawGroundPlinth(buf, 32, 56, 24, 5.5, RAMPS.moss, RAMPS.sandstone);
  buf.layer((sub) => {
    drawArchedPortal(sub, 32, 55, 5, 11, RAMPS.marble, 'void');
  });
  buf.layer((canopy) => {
    canopy.fillEllipse(32, 18, 15, 11, () => RAMPS.moss.mid);
  });
  return buf;
}`,
  },
  {
    id: 'orc-war-camp-t1',
    name: 'Лагерь Орды',
    subtitle: 'Укреплённый шатёр вождя (58×58)',
    kind: 'static',
    tier: 'I',
    faction: 'Орда',
    width: 58,
    height: 58,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: [
      '0. Утоптанный боевой плац',
      '1. Заострённый частокол с железными стяжками',
      '2. Боевой шатёр с бивнями, масками K1/K2 и тотемными черепами',
      '3. Кострище и стойка трофейного оружия',
    ],
    description:
      'Базовая постройка уровня I для Орды: заострённый частокол, шатёр из шкур с узором державы (K1/K2), клыками и тотемами.',
    renderFrame: () => renderOrcWarCampT1(),
    codeSnippet: `function renderOrcWarCampT1(): PixelBuffer {
  const buf = new PixelBuffer(58, 58);
  drawGroundPlinth(buf, 29, 50, 22, 5.5, RAMPS.sandstone, RAMPS.timber);
  buf.layer((sub) => {
    sub.drawSkull(12, 34, 'mini', RAMPS.lava.highlight, RAMPS.bone);
    drawBrazier(sub, 29, 49, 0.7, RAMPS.lava);
  });
  return buf;
}`,
  },
];
