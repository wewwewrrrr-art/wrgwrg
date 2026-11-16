import { RAMPS } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef } from './types';

/**
 * ============================================================================
 * WEATHER CONDITIONS & ATMOSPHERIC VFX (10 SEAMLESS ANIMATED MODELS)
 * ============================================================================
 * Built WITHOUT heavy dark outer INK contours so rain, clouds, rolling fog,
 * snowstorms, sandstorms, tornadoes, auroras, and water geysers blend cleanly
 * over dark, checkered, meadow, and light terrains using layered alpha RGBA.
 * ============================================================================
 */

function paintCloudMass(
  buf: PixelBuffer,
  lobes: readonly { cx: number; cy: number; rx: number; ry: number }[],
  brightHex: string,
  midHex: string,
  shadowHex: string,
  deepHex: string,
  flash = false
): void {
  for (const l of lobes) {
    buf.fillEllipse(l.cx, l.cy, l.rx, l.ry, (nx, ny) => {
      if (flash && ny > 0.05 && Math.hypot(nx, ny) < 0.72) return '#FFF9D6EE';
      if (ny > 0.45) return deepHex;
      if (ny > 0.1 || nx > 0.4) return shadowHex;
      if (ny < -0.25 && nx < 0.2) return brightHex;
      return midHex;
    });
  }
}

/**
 * 1. Downpour Rain (52x52, Tier I, 16f)
 * Multi-depth parallax diagonal rain streaks, soft overcast mist top,
 * and expanding water splash ripples on ground plane.
 */
function renderRainWeather(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(52, 52);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  // Soft upper overcast mist canopy
  paintCloudMass(
    buf,
    [
      { cx: 16, cy: 10, rx: 11, ry: 4.5 },
      { cx: 30, cy: 9, rx: 13, ry: 5 },
      { cx: 40, cy: 11, rx: 8, ry: 4 },
    ],
    '#B6C7D9BB',
    '#8496ABAA',
    '#5D6E8F99',
    '#3B476199'
  );

  // Far & near diagonal raindrop streaks (seamless loop over 16 frames)
  const drops = 18;
  for (let i = 0; i < drops; i++) {
    const isNear = i % 2 === 0;
    const speed = isNear ? 2 : 1;
    const p = ((frame * speed + i * 3) % total) / total;
    const baseX = 7 + ((i * 11) % 38);
    const y = Math.round(13 + p * 34);
    const x = Math.round(baseX - p * 7);
    const len = isNear ? 4 : 3;
    const colHead = isNear ? '#E6F0FAEE' : '#8FA4C799';
    const colTail = isNear ? '#6CC0E599' : '#5D6E8F66';
    for (let k = 0; k < len; k++) {
      const py = y - k;
      const px = x + Math.round(k * 0.3);
      if (py >= 11 && py <= 46) {
        buf.setPixel(px, py, k === 0 ? colHead : colTail);
      }
    }
  }

  // Animated splash rings along ground horizon (y = 46..48)
  for (let s = 0; s < 4; s++) {
    const phase = (frame + s * 4) % 8;
    const sx = 11 + s * 10 + Math.round(Math.sin(s * 2) * 2);
    const sy = 47;
    if (phase < 3) {
      buf.setPixel(sx - 1, sy - 1, '#E6F0FADD');
      buf.setPixel(sx + 1, sy - 1, '#E6F0FADD');
      buf.drawLine(sx - 2, sy, sx + 2, sy, '#6CC0E5AA');
    } else if (phase < 6) {
      buf.drawLine(sx - 3, sy, sx + 3, sy, '#B6C7D966');
    } else {
      buf.setPixel(sx, sy, '#E6F0FA99');
    }
  }
  // Subtle damp ground sheen
  buf.fillEllipse(26, 48, 19, 1.5, '#6CC0E533');
  if (Math.sin(t) > 2) buf.setPixel(0, 0, null);

  return buf;
}

/**
 * 2. Storm Thundercloud & Forked Lightning (56x52, Tier II, 16f)
 */
function renderThundercloudWeather(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 52);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const drift = Math.round(Math.sin(t) * 1.5);
  const isStrike = frame === 3 || frame === 4 || frame === 11 || frame === 12;

  // Heavy billowing thundercloud bank
  paintCloudMass(
    buf,
    [
      { cx: 14 + drift, cy: 17, rx: 10, ry: 6 },
      { cx: 42 + drift, cy: 17, rx: 10, ry: 6 },
      { cx: 22 + drift, cy: 12, rx: 11, ry: 7 },
      { cx: 34 + drift, cy: 13, rx: 10, ry: 6.5 },
      { cx: 28 + drift, cy: 18, rx: 15, ry: 6 },
    ],
    isStrike ? '#E6F0FAEE' : '#8FA4C7EE',
    isStrike ? '#8FA4C7EE' : '#5D6E8FEE',
    '#3B4761EE',
    '#242C3DEE',
    isStrike
  );

  // Diagonal storm rain curtains beneath cloud
  for (let i = 0; i < 12; i++) {
    const p = ((frame * 2 + i * 3) % total) / total;
    const rx = Math.round(12 + ((i * 9) % 34) - p * 8);
    const ry = Math.round(23 + p * 23);
    buf.drawLine(rx, ry, rx + 1, ry - 3, '#6CC0E599');
  }

  // Jagged forked lightning bolt striking downward on storm peak frames
  if (isStrike) {
    const lx = frame < 8 ? 25 + drift : 32 + drift;
    const pts: [number, number][] = [
      [lx, 21],
      [lx - 3, 27],
      [lx + 2, 31],
      [lx - 4, 39],
      [lx - 1, 47],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      buf.drawLine(pts[i][0] + 1, pts[i][1], pts[i + 1][0] + 1, pts[i + 1][1], '#6CC0E5CC', 2);
      buf.drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], '#FFFFFF', 1);
    }
    // Secondary lightning fork
    buf.drawLine(lx + 2, 31, lx + 7, 37, '#FFF2A6DD', 1);
    buf.fillEllipse(lx - 1, 47, 5, 1.5, '#FFF2A699');
  }

  return buf;
}

/**
 * 3. Cumulus Clouds & Golden Sunbeams (56x48, Tier I, 16f)
 */
function renderCumulusCloudWeather(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const d1 = Math.round(Math.sin(t) * 2.2);
  const d2 = Math.round(Math.cos(t) * 1.5);

  // Warm diagonal golden sunbeams breaking beneath cloud gap
  for (let b = 0; b < 3; b++) {
    const bx = 18 + b * 9 + Math.round(Math.sin(t + b) * 1.2);
    const pulse = Math.sin(t * 2 + b) > 0;
    for (let y = 24; y <= 44; y++) {
      const spread = (y - 24) * 0.28;
      buf.setPixel(Math.round(bx - spread), y, pulse ? '#FFF2A666' : '#FFF2A644');
      buf.setPixel(Math.round(bx - spread + 1), y, '#FFF2A633');
    }
  }

  // Far secondary soft cloudlet
  paintCloudMass(
    buf,
    [
      { cx: 38 + d2, cy: 19, rx: 9, ry: 5 },
      { cx: 44 + d2, cy: 21, rx: 6, ry: 4 },
    ],
    '#FFFFFFEE',
    '#E6F0FADD',
    '#B6C7D9CC',
    '#8496ABCC'
  );

  // Primary fluffy sunlit cumulus bank
  paintCloudMass(
    buf,
    [
      { cx: 14 + d1, cy: 20, rx: 8.5, ry: 5.5 },
      { cx: 29 + d1, cy: 20, rx: 9.5, ry: 5.5 },
      { cx: 21 + d1, cy: 14, rx: 9, ry: 6.5 },
      { cx: 22 + d1, cy: 21, rx: 12, ry: 4.5 },
    ],
    '#FFFFFF',
    '#E6F0FAEE',
    '#B6C7D9EE',
    '#8496ABDD'
  );

  return buf;
}

/**
 * 4. Rolling Dense Fog Bank (56x48, Tier I, 16f)
 * Translucent horizontal undulating layers of mist drifting past one another.
 */
function renderFogBankWeather(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 48);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  const strata = [
    { y: 18, amp: 2.2, shift: 1, col: '#B6C7D944', highlight: '#E6F0FA55', w: 20 },
    { y: 24, amp: 2.8, shift: -1.3, col: '#8496AB66', highlight: '#E6F0FA77', w: 23 },
    { y: 31, amp: 2.5, shift: 1.6, col: '#B6C7D988', highlight: '#FFFFFF88', w: 24 },
    { y: 37, amp: 2.0, shift: -0.9, col: '#8496AB99', highlight: '#E6F0FA99', w: 22 },
  ];

  strata.forEach((s, idx) => {
    const ox = Math.round(Math.sin(t + idx * 1.4) * 3.5 * s.shift);
    for (let k = -2; k <= 2; k++) {
      const cx = 28 + k * 7 + ox;
      const cy = s.y + Math.round(Math.cos(t + k * 1.1 + idx) * s.amp);
      const rx = 8 + (k % 2 === 0 ? 2 : 0);
      const ry = 3.2;
      buf.fillEllipse(cx, cy, rx, ry, (_nx, ny) =>
        ny < -0.25 ? s.highlight : ny > 0.35 ? '#5A697A66' : s.col
      );
    }
    // Thin drifting horizontal vapor wisps
    const wx = 12 + Math.round(((frame * (idx + 1) + idx * 9) % 30));
    buf.drawLine(wx, s.y - 3, wx + 8, s.y - 3, '#E6F0FA66');
  });

  return buf;
}

/**
 * 5. Blizzard & Swirling Snowstorm (52x52, Tier II, 16f)
 */
function renderBlizzardWeather(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(52, 52);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  // Low blowing frost ground drift
  buf.fillEllipse(26 + Math.round(Math.sin(t) * 3), 45, 21, 3.2, (_nx, ny) =>
    ny < 0 ? '#E6F0FA99' : '#B6C7D966'
  );

  // Diagonal wind-blown snow streaks
  for (let i = 0; i < 16; i++) {
    const p = ((frame + i * 2) % total) / total;
    const x = Math.round(46 - ((p * 42 + i * 7) % 42));
    const y = Math.round(6 + ((p * 38 + i * 5) % 38));
    buf.drawLine(x, y, x + 2, y - 1, i % 2 === 0 ? '#FFFFFFCC' : '#C2F0FF99');
  }

  // Crisp rotating 3x3 cross/star snowflakes
  const stars = [
    { x0: 14, y0: 14, spd: 1 },
    { x0: 32, y0: 11, spd: 2 },
    { x0: 23, y0: 25, spd: 1 },
    { x0: 40, y0: 29, spd: 2 },
    { x0: 12, y0: 34, spd: 1 },
  ];
  stars.forEach((st, idx) => {
    const p = ((frame * st.spd + idx * 3) % total) / total;
    const sx = Math.round(((st.x0 - p * 22 + 48) % 42) + 5);
    const sy = Math.round(((st.y0 + p * 36) % 38) + 5);
    buf.setPixel(sx, sy, '#FFFFFF');
    buf.setPixel(sx - 1, sy, '#C2F0FFDD');
    buf.setPixel(sx + 1, sy, '#C2F0FFDD');
    buf.setPixel(sx, sy - 1, '#C2F0FFDD');
    buf.setPixel(sx, sy + 1, '#C2F0FFDD');
  });

  return buf;
}

/**
 * 6. Desert Sandstorm Gusts (54x50, Tier II, 12f)
 */
function renderSandstormWeather(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(54, 50);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  // Rolling ochre dust waves
  for (let band = 0; band < 4; band++) {
    const baseY = 16 + band * 8;
    const ox = Math.round(Math.sin(t + band * 1.2) * 4);
    for (let x = 6; x <= 47; x++) {
      const wave = Math.round(Math.sin(x * 0.22 - t * 2 + band) * 2.2);
      const py = baseY + wave;
      buf.setPixel(x, py, '#D5AA6B77');
      buf.setPixel(x, py + 1, '#B0824766');
      if ((x + ox) % 3 === 0) buf.setPixel(x, py - 1, '#FFF2A666');
    }
  }

  // Fast sweeping sand grains across wind shear
  for (let i = 0; i < 20; i++) {
    const p = ((frame * 2 + i * 2) % total) / total;
    const gx = Math.round(6 + ((p * 44 + i * 6) % 44));
    const gy = Math.round(12 + ((i * 7) % 30) + Math.sin(t + i) * 1.5);
    buf.fillRect(gx, gy, i % 3 === 0 ? 2 : 1, 1, i % 2 === 0 ? '#FFF2A6DD' : '#D5AA6BBB');
  }

  // Swirling dust cloud puff at base
  buf.fillEllipse(27 + Math.round(Math.sin(t) * 3), 42, 18, 3.5, '#B0824777');

  return buf;
}

/**
 * Shared parameterized spinning tornado vortex renderer supporting intensity degrees I..III
 * Matching reference image_032f57a9.png: flat swirling dark storm disc top,
 * S-curved pale-blue funnel, diagonal white wind ribbons, and orbiting dirt/rock chunks.
 */
function renderTornadoCore(
  buf: PixelBuffer,
  frame: number,
  total: number,
  opts: {
    cx: number;
    topY: number;
    botY: number;
    topRx: number;
    botRx: number;
    swayAmp: number;
    capColors: [string, string, string];
    funnelColors: [string, string, string, string];
    debrisCount: number;
    lightning?: boolean;
    dustTone?: boolean;
  }
): void {
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const h = opts.botY - opts.topY;

  // 1. Smooth S-curved twisting funnel built from helical wind bands & crisp white spiral ribbons
  for (let y = opts.topY + 2; y <= opts.botY; y++) {
    const p = 1 - (y - opts.topY) / Math.max(1, h); // 1 near top -> 0 at foot
    const sBend = Math.sin(t * 1.4 + p * 3.8) * opts.swayAmp * (0.35 + p * 0.55);
    const arcOffset = Math.sin(p * Math.PI) * (opts.swayAmp * 0.55);
    const centerX = Math.round(opts.cx + sBend - arcOffset);
    const rx = Math.max(1.5, opts.botRx + Math.pow(p, 1.32) * (opts.topRx - opts.botRx - 0.5));
    const maxDx = Math.round(rx);

    for (let dx = -maxDx; dx <= maxDx; dx++) {
      const nx = dx / (rx || 1);
      const helix = Math.sin(nx * 2.4 - t * 3 + y * 0.34);
      // Soft feathering only at extreme outer column rim (keeps clean smooth S-silhouette)
      if (Math.abs(nx) > 0.94 && helix < -0.35) continue;

      let col: string;
      if (helix > 0.72) {
        col = '#FFFFFFF0'; // Crisp diagonal spiraling wind ribbon
      } else if (nx < -0.25 || helix > 0.28) {
        col = opts.funnelColors[0];
      } else if (nx > 0.45) {
        col = opts.funnelColors[3];
      } else if (nx > 0.1) {
        col = opts.funnelColors[2];
      } else {
        col = opts.funnelColors[1];
      }
      buf.setPixel(centerX + dx, y, col);
    }
  }

  // 2. Dark swirling storm-eye cap disc overlapping funnel top (exact signature from image_032f57a9.png)
  const capCx = opts.cx + Math.round(Math.sin(t * 1.4 + 3.8) * (opts.swayAmp * 0.45));
  buf.fillEllipse(capCx, opts.topY, opts.topRx + 0.5, Math.max(3.4, opts.topRx * 0.35), (nx, ny, px, py) => {
    const ring = Math.sin(Math.hypot(nx, ny * 2.1) * 7.5 - t * 2);
    if (opts.lightning && frame % 7 === 0 && Math.abs(nx) < 0.35 && ny > 0.05) return '#FFF6B8EE';
    if (ring > 0.48) return opts.capColors[0];
    if (ny > 0.35 || (px + py) % 5 === 0) return opts.capColors[2];
    return opts.capColors[1];
  });
  // Crisp tapered wind wisp whipping cleanly off the cap rim
  const wispAng = t * 2;
  const wx = capCx + Math.round(Math.cos(wispAng) * opts.topRx);
  const wy = opts.topY + Math.round(Math.sin(wispAng) * 1.8);
  buf.drawLine(wx, wy, wx + (Math.cos(wispAng) >= 0 ? 2 : -2), wy - 1, '#FFFFFFCC', 1);

  // 3. Swirling ground dust collar + chunky dirt/stone clods spun around base
  const footCx = Math.round(opts.cx + Math.sin(t * 1.4) * (opts.swayAmp * 0.35));
  buf.fillEllipse(
    footCx,
    opts.botY + 1,
    Math.max(5, opts.botRx + 6),
    2.2,
    opts.dustTone ? '#C49A6277' : '#8A7E6B77'
  );
  const tailDir = Math.cos(t * 2) >= 0 ? 1 : -1;
  buf.drawLine(footCx - tailDir * 2, opts.botY - 1, footCx + tailDir * 4, opts.botY - 2, '#FFFFFFCC', 1);

  for (let i = 0; i < opts.debrisCount; i++) {
    const p = ((frame + i * 2) % total) / total;
    const isBottomClod = i < Math.ceil(opts.debrisCount * 0.55);
    if (isBottomClod) {
      const ang = t * 2.5 + i * 2.1;
      const dx = Math.round(footCx + Math.cos(ang) * (4 + (i % 3) * 3));
      const dy = Math.round(opts.botY - 1 + Math.sin(ang) * 2.0);
      buf.fillRect(dx, dy, i % 2 === 0 ? 3 : 2, 2, i % 2 === 0 ? '#5C5042' : '#7A6B57');
      buf.setPixel(dx, dy, '#968772');
    } else {
      const py = Math.round(opts.botY - 5 - p * (h - 9));
      const heightRatio = Math.max(0, Math.min(1, 1 - (py - opts.topY) / Math.max(1, h)));
      const rad = 2.5 + heightRatio * (opts.topRx * 0.72);
      const px = Math.round(opts.cx + Math.cos(t * 2.5 + i * 1.7) * rad);
      buf.setPixel(px, py, i % 2 === 0 ? '#FFFFFFBB' : RAMPS.timber.shadow);
    }
  }
}

/**
 * 7a. Tornado Degree I — Agile Dust Devil Whirlwind (48x52, Tier I, 16f)
 */
function renderDustDevilVfx(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(48, 52);
  renderTornadoCore(buf, frame, total, {
    cx: 24,
    topY: 16,
    botY: 45,
    topRx: 7.5,
    botRx: 1.5,
    swayAmp: 3.0,
    capColors: ['#B8A07ACC', '#967F5ABB', '#6B593EBB'],
    funnelColors: ['#F2E6D0DD', '#D6BD94CC', '#B39366BB', '#826745BB'],
    debrisCount: 5,
    dustTone: true,
  });
  return buf;
}

/**
 * 7b. Tornado Degree II — Storm Twister (54x56, Tier III, 16f)
 * Faithful to image_032f57a9.png: slate storm-cap disc, S-funnel, diagonal white ribbons, dirt clods.
 */
function renderTornadoVfx(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(54, 56);
  renderTornadoCore(buf, frame, total, {
    cx: 27,
    topY: 11,
    botY: 48,
    topRx: 11.5,
    botRx: 2.0,
    swayAmp: 4.0,
    capColors: ['#7D8BA3EE', '#63718AE6', '#455066EE'],
    funnelColors: ['#E6F5FAEE', '#B4D6E8DD', '#7FA5BFCC', '#526D85CC'],
    debrisCount: 7,
  });
  return buf;
}

/**
 * 7c. Tornado Degree III — Catastrophic Mega-Tornado F5 (58x58, Tier III, 16f)
 */
function renderMegaTornadoVfx(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 58);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  // Wide storm supercell skirt behind vortex cap
  paintCloudMass(
    buf,
    [
      { cx: 19 + Math.round(Math.sin(t) * 1.5), cy: 10, rx: 13, ry: 5 },
      { cx: 38 + Math.round(Math.sin(t) * 1.5), cy: 10, rx: 13, ry: 5 },
    ],
    '#8A98B0BB',
    '#5E6B82CC',
    '#3F4A5EDD',
    '#293040DD'
  );
  renderTornadoCore(buf, frame, total, {
    cx: 29,
    topY: 11,
    botY: 51,
    topRx: 17.5,
    botRx: 3.5,
    swayAmp: 5.5,
    capColors: ['#75849CEE', '#525E75EE', '#31394AEE'],
    funnelColors: ['#EEF8FCFA', '#A6CDE0E6', '#698FA8DD', '#3D5369DD'],
    debrisCount: 12,
    lightning: true,
  });
  return buf;
}

/**
 * 11. Earthquake Tectonic Rift Scar (56x52, Tier III, 16f)
 * Matching image_b1c8a830.png: branching jagged fissure uplifting sand crust + grey rock ridge.
 */
function renderEarthquakeRiftVfx(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 52);
  const p = frame / Math.max(1, total);
  const shakeX = frame % 2 === 0 ? -1 : 1;
  const spread = 0.55 + Math.sin(p * Math.PI) * 0.45; // scar pulses open & fractures outward

  // Main diagonal jagged tectonic spine points (x, y, width)
  const spine: [number, number, number][] = [
    [7, 9, 1.5],
    [13, 15, 2.6],
    [18, 20, 3.4],
    [25, 22, 3.8],
    [32, 26, 4.0],
    [37, 34, 3.5],
    [43, 40, 2.4],
    [49, 45, 1.4],
  ];
  const branches: [number, number, number, number][] = [
    [18, 20, 7, 29],
    [25, 22, 31, 10],
    [32, 26, 48, 25],
    [34, 30, 20, 42],
    [14, 16, 8, 17],
    [39, 36, 48, 36],
  ];

  // 1. Pale uplifted jagged sand/subsoil collar along scar & sharp tapering side branches
  for (let i = 0; i < branches.length; i++) {
    const [bx1, by1, bx2, by2] = branches[i];
    const mx = Math.round(bx1 + (bx2 - bx1) * spread);
    const my = Math.round(by1 + (by2 - by1) * spread);
    const midX = Math.round((bx1 + mx) * 0.5 + (i % 2 === 0 ? 1 : -1));
    const midY = Math.round((by1 + my) * 0.5 - (i % 2 === 0 ? 1 : 0));
    buf.drawLine(bx1, by1, midX, midY, '#DFCA86CC', 2);
    buf.drawLine(midX, midY, mx, my, '#DFCA86BB', 1);
  }
  for (const [sx, sy, sw] of spine) {
    buf.fillEllipse(sx + shakeX, sy, sw * 1.35, sw * 0.95, () => '#DFCA86CC');
  }

  // 2. Exposed grey granite ridge pushed up along central tectonic crack
  for (let i = 0; i < 4; i++) {
    const [bx1, by1, bx2, by2] = branches[i];
    const mx = Math.round(bx1 + (bx2 - bx1) * spread * 0.62);
    const my = Math.round(by1 + (by2 - by1) * spread * 0.62);
    buf.drawLine(bx1, by1, mx, my, '#96938E', 1);
  }
  for (let i = 0; i < spine.length; i++) {
    const [sx, sy, sw] = spine[i];
    buf.fillEllipse(sx + shakeX, sy, sw * 0.78, sw * 0.56, (_nx, ny) =>
      ny < -0.25 ? '#C4C1BC' : ny > 0.35 ? '#595755' : '#94918C'
    );
  }

  // 3. Tiny uplifted soil crust chips & seismic dust puffs
  for (let i = 0; i < 6; i++) {
    const fp = ((frame + i * 3) % total) / total;
    const idx = i % spine.length;
    const [ox, oy] = spine[idx];
    const dx = Math.round(ox + Math.cos(i * 1.7) * (3 + fp * 6));
    const dy = Math.round(oy - fp * 6);
    buf.setPixel(dx, dy, fp < 0.5 ? '#EDE2C4CC' : '#8F8D8988');
  }

  return buf;
}

/**
 * 8. Rising Firestorm & Embers Vortex (50x54, Tier III, 12f)
 */
function renderFirestormVfx(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(50, 54);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  // Translucent dark smoke swirls at top
  paintCloudMass(
    buf,
    [
      { cx: 22 + Math.round(Math.sin(t) * 2), cy: 13, rx: 8, ry: 5 },
      { cx: 29 + Math.round(Math.cos(t) * 2), cy: 11, rx: 7, ry: 4.5 },
    ],
    '#8496AB88',
    '#5A697A77',
    '#3B476177',
    '#242C3D66'
  );

  // Helical roaring fire column
  for (let y = 16; y <= 46; y++) {
    const p = (y - 16) / 30;
    const cx = Math.round(25 + Math.sin(t * 2 - p * 4.5) * (2.5 + (1 - p) * 2.5));
    const hw = Math.round(3 + Math.sin(p * Math.PI) * 7.5);
    for (let dx = -hw; dx <= hw; dx++) {
      const dist = Math.abs(dx) / (hw || 1);
      const tongue = Math.sin(dx * 0.7 + t * 3 + y * 0.4);
      if (dist > 0.8 && tongue < 0) continue;
      const c =
        dist < 0.25 && y > 26
          ? '#FFFFFF'
          : dist < 0.55
            ? RAMPS.gold.highlight
            : dist < 0.8
              ? RAMPS.lava.mid
              : RAMPS.lava.shadow;
      buf.setPixel(cx + dx, y, c);
    }
  }

  // Rising glowing ember sparks
  for (let i = 0; i < 8; i++) {
    const p = ((frame + i * 2) % total) / total;
    const ex = Math.round(25 + Math.cos(t * 2 + i * 1.4) * (6 + p * 7));
    const ey = Math.round(44 - p * 36);
    buf.setPixel(ex, ey, i % 2 === 0 ? '#FFFFFF' : RAMPS.gold.highlight);
  }

  return buf;
}

/**
 * 9. Arcane Aurora Borealis & Mana Veil (52x54, Tier III, 16f)
 * Shimmering vertical energy curtains in K1/K2/Emerald masks + floating stars.
 */
function renderAuroraVfx(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(52, 54);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;

  for (let x = 8; x <= 43; x++) {
    const wave = Math.sin(x * 0.24 - t) * 4 + Math.cos(x * 0.14 + t) * 2;
    const baseY = Math.round(35 + wave);
    const curtainH = Math.round(16 + Math.sin(x * 0.35 + t * 2) * 5);
    for (let h = 0; h < curtainH; h++) {
      const p = h / curtainH;
      const py = baseY - h;
      const band = (x + Math.floor(frame / 2)) % 9;
      let col: string;
      if (p < 0.15) col = '#FFFFFFDD';
      else if (p < 0.45) col = band < 3 ? RAMPS.cyanMask.highlight : band < 6 ? RAMPS.emerald.highlight : RAMPS.magenta.highlight;
      else if (p < 0.75) col = band < 3 ? '#00DBDB99' : band < 6 ? '#2AB36E88' : '#D900EB88';
      else col = '#9C58E044';
      buf.setPixel(x, py, col);
    }
  }

  // Twinkling ascending mana stars
  for (let i = 0; i < 6; i++) {
    const p = ((frame + i * 3) % total) / total;
    const sx = 11 + i * 6 + Math.round(Math.sin(t + i) * 1.5);
    const sy = Math.round(43 - p * 30);
    buf.setPixel(sx, sy, '#FFFFFF');
  }

  return buf;
}

/**
 * 10. Pressurized Water Geyser & Foam Plume (50x54, Tier II, 16f)
 */
function renderWaterGeyserVfx(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(50, 54);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const surge = 0.65 + (Math.sin(t) + 1) * 0.22; // pulsating eruption height

  // Rocky hydrothermal vent rim at bottom
  buf.fillEllipse(25, 46, 13, 3.5, (nx, ny) =>
    ny < -0.2 ? RAMPS.slate.highlight : nx > 0.3 ? RAMPS.slate.deep : RAMPS.slate.mid
  );
  buf.fillEllipse(25, 45, 7, 2, RAMPS.ice.mid);

  // Pressurized rising water jet column
  const jetHeight = Math.round(28 * surge);
  const topY = 45 - jetHeight;
  for (let y = topY; y <= 45; y++) {
    const p = (y - topY) / Math.max(1, jetHeight);
    const hw = Math.round(2 + (1 - p) * 2.5 + (p > 0.8 ? 2 : 0));
    for (let dx = -hw; dx <= hw; dx++) {
      const foam = (dx + y + frame) % 3 === 0;
      const c =
        Math.abs(dx) <= 1 && foam
          ? '#FFFFFF'
          : dx < 0
            ? RAMPS.ice.highlight
            : RAMPS.ice.mid;
      buf.setPixel(25 + dx, y, c);
    }
  }

  // Cascading crown spray & arcing droplets
  paintCloudMass(
    buf,
    [
      { cx: 25, cy: topY, rx: 6, ry: 3.2 },
      { cx: 20, cy: topY + 2, rx: 4, ry: 2.5 },
      { cx: 30, cy: topY + 2, rx: 4, ry: 2.5 },
    ],
    '#FFFFFFEE',
    '#E6F0FADD',
    '#C2F0FFBB',
    '#6CC0E588'
  );

  for (let i = 0; i < 8; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    const p = ((frame + i * 2) % 8) / 8;
    const dx = Math.round(25 + dir * (4 + p * 11));
    const dy = Math.round(topY + 2 + p * p * 26);
    if (dy <= 46) buf.setPixel(dx, dy, p < 0.5 ? '#FFFFFF' : RAMPS.ice.highlight);
  }

  return buf;
}

export const WEATHER_MODELS: PixelModelDef[] = [
  {
    id: 'weather-rain',
    name: 'Проливной Дождь',
    subtitle: '3 слоя косых струй и всплески (52×52)',
    kind: 'weather',
    tier: 'I',
    faction: 'Бастион Мороза',
    width: 52,
    height: 52,
    frameCount: 16,
    defaultFps: 14,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Верхняя полупрозрачная дымка дождевого фронта',
      '1. Дальний и ближний параллакс-слои косых капель',
      '2. Анимированные колечки брызг на земле',
    ],
    description:
      'Многослойная погодная система дождя с бесшовным 16-кадровым циклом падения струй и динамическими брызгами у поверхности.',
    renderFrame: (f, tot) => renderRainWeather(f, tot),
    codeSnippet: `function renderRainWeather(frame: number, total: number): PixelBuffer { /* parallax rain + ground splashes */ return new PixelBuffer(52, 52); }`,
  },
  {
    id: 'weather-thundercloud',
    name: 'Грозовая Туча с Молнией',
    subtitle: 'Свинцовые облака, зарница и разряд (56×52)',
    kind: 'weather',
    tier: 'II',
    faction: 'Цитадель',
    width: 56,
    height: 52,
    frameCount: 16,
    defaultFps: 12,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Многоярусные свинцово-синие клубы тучи со смещением',
      '1. Косые струи штормового ливня',
      '2. Вспышки внутренней зарницы и ветвистая молния до земли',
    ],
    description:
      'Драматичный грозовой фронт: дрейфующая грозовая туча вспыхивает изнутри перед каждым ветвистым ударом молнии.',
    renderFrame: (f, tot) => renderThundercloudWeather(f, tot),
    codeSnippet: `function renderThundercloudWeather(frame: number, total: number): PixelBuffer { /* storm bank + forked lightning */ return new PixelBuffer(56, 52); }`,
  },
  {
    id: 'weather-cumulus-cloud',
    name: 'Кучевые Облака и Лучи',
    subtitle: 'Объёмные белые облака и солнце (56×48)',
    kind: 'weather',
    tier: 'I',
    faction: 'Цитадель',
    width: 56,
    height: 48,
    frameCount: 16,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Диагональные золотистые солнечные лучи',
      '1. Дальний и ближний ярусы пушистых кучевых облаков',
      '2. Плавный параллакс-дрейф по небу',
    ],
    description:
      'Ясная погодная формация: объёмные бело-голубые облака с мягким затенением основания и пробивающимися лучами света.',
    renderFrame: (f, tot) => renderCumulusCloudWeather(f, tot),
    codeSnippet: `function renderCumulusCloudWeather(frame: number, total: number): PixelBuffer { /* cumulus clouds + golden sunbeams */ return new PixelBuffer(56, 48); }`,
  },
  {
    id: 'weather-fog-bank',
    name: 'Густой Ползущий Туман',
    subtitle: '4 пласта полупрозрачной дымки α (56×48)',
    kind: 'weather',
    tier: 'I',
    faction: 'Некрополь',
    width: 56,
    height: 48,
    frameCount: 16,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Четыре горизонтальных пласта волнистой дымки разной плотности',
      '1. Противофазное перетекание слоёв тумана',
      '2. Тонкие нити утреннего испарения',
    ],
    description:
      'Объёмный низовой туман на базе альфа-слоёв RGBA (#RRGGBBAA): плавно стелется над болотами, реками и руинами без грубых контуров.',
    renderFrame: (f, tot) => renderFogBankWeather(f, tot),
    codeSnippet: `function renderFogBankWeather(frame: number, total: number): PixelBuffer { /* 4-layer alpha rolling fog */ return new PixelBuffer(56, 48); }`,
  },
  {
    id: 'weather-blizzard',
    name: 'Метель и Снегопад',
    subtitle: 'Резные снежинки и позёмка (52×52)',
    kind: 'weather',
    tier: 'II',
    faction: 'Бастион Мороза',
    width: 52,
    height: 52,
    frameCount: 16,
    defaultFps: 13,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Низовая снежная позёмка у поверхности',
      '1. Быстрые косые полосы пурги',
      '2. Крупные крестообразные снежинки разных скоростей',
    ],
    description:
      'Зимняя вьюга с двухскоростным падением снега, крупными резными снежинками и волнами низовой позёмки.',
    renderFrame: (f, tot) => renderBlizzardWeather(f, tot),
    codeSnippet: `function renderBlizzardWeather(frame: number, total: number): PixelBuffer { /* wind-swept snowflakes + ground drift */ return new PixelBuffer(52, 52); }`,
  },
  {
    id: 'weather-sandstorm',
    name: 'Песчаная Буря',
    subtitle: 'Вихревые ленты пыли и барханы (54×50)',
    kind: 'weather',
    tier: 'II',
    faction: 'Орда',
    width: 54,
    height: 50,
    frameCount: 12,
    defaultFps: 14,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Четыре волновые ленты пустынной пыли',
      '1. Плотный рой летящих золотых песчинок',
      '2. Пылевой вихрь у основания дюны',
    ],
    description:
      'Горячий пустынный шквал: полупрозрачные охристые волны пыли и скоростной поток песчинок с порывами ветра.',
    renderFrame: (f, tot) => renderSandstormWeather(f, tot),
    codeSnippet: `function renderSandstormWeather(frame: number, total: number): PixelBuffer { /* ochre dust ribbons + sand grains */ return new PixelBuffer(54, 50); }`,
  },
  {
    id: 'vfx-tornado',
    name: 'Смерч II степени (Штормовой Вихрь)',
    subtitle: 'Воронка со спиралями ветра и обломками (54×56)',
    kind: 'weather',
    tier: 'III',
    faction: 'Лесной Круг',
    width: 54,
    height: 56,
    frameCount: 16,
    defaultFps: 14,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Плоский вращающийся свинцовый диск штормовой шапки',
      '1. S-образная воронка с белыми спиральными лентами воздуха',
      '2. Вращающиеся комья земли, камни и пыль у основания',
    ],
    description:
      'Динамический торнадо II степени: вращающийся грозовой глаз сверху, S-образная воронка со спиральными потоками ветра и срывающиеся комья грунта у земли.',
    renderFrame: (f, tot) => renderTornadoVfx(f, tot),
    codeSnippet: `function renderTornadoVfx(frame: number, total: number): PixelBuffer { /* storm cap + S-funnel + wind ribbons */ return new PixelBuffer(54, 56); }`,
  },
  {
    id: 'vfx-dust-devil',
    name: 'Вихрь I степени (Пылевой Смерч)',
    subtitle: 'Лёгкий песчаный вихрь с пылью (48×52)',
    kind: 'weather',
    tier: 'I',
    faction: 'Орда',
    width: 48,
    height: 52,
    frameCount: 16,
    defaultFps: 14,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Компактная пылевая воронка сухого ветра',
      '1. Закрученные спирали песка и мелкие щепки',
    ],
    description:
      'Торнадо начальной I степени: узкий подвижный пылевой смерч, поднимающий сухую землю и песок по спирали.',
    renderFrame: (f, tot) => renderDustDevilVfx(f, tot),
    codeSnippet: `function renderDustDevilVfx(frame: number, total: number): PixelBuffer { /* Stage I agile dust devil */ return new PixelBuffer(48, 52); }`,
  },
  {
    id: 'vfx-mega-tornado',
    name: 'Мега-Торнадо III степени (Буря F5)',
    subtitle: 'Суперъячейка, молнии и шквал (58×58)',
    kind: 'weather',
    tier: 'III',
    faction: 'Бастион Мороза',
    width: 58,
    height: 58,
    frameCount: 16,
    defaultFps: 15,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Широкая грозовая суперъячейка с вспышками молний',
      '1. Мощный двойной вихревой конус со шквальными жгутами',
      '2. Кольцо вырванной породы и обломков у поверхности',
    ],
    description:
      'Торнадо высшей III степени разрушения (F5): широкая многоярусная воронка, внутренние зарницы и орбитальные глыбы грунта.',
    renderFrame: (f, tot) => renderMegaTornadoVfx(f, tot),
    codeSnippet: `function renderMegaTornadoVfx(frame: number, total: number): PixelBuffer { /* Stage III F5 supercell tornado */ return new PixelBuffer(58, 58); }`,
  },
  {
    id: 'vfx-earthquake-rift',
    name: 'Землетрясение (Тектонический Шрам)',
    subtitle: 'Разлом, вздыбленная порода и песок (56×52)',
    kind: 'weather',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 56,
    height: 52,
    frameCount: 16,
    defaultFps: 12,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Вздыбленная кромка песка и подпочвы по краям разлома',
      '1. Центральный каменный гребень, поднятый из глубины слоёв',
      '2. Ветвистые сейсмические трещины и выбросы пыли',
    ],
    description:
      'Сейсмический разлом землетрясения: ветвистый тектонический шрам вспарывает почву, обнажая слой песка и поднимая серый горный хребет.',
    renderFrame: (f, tot) => renderEarthquakeRiftVfx(f, tot),
    codeSnippet: `function renderEarthquakeRiftVfx(frame: number, total: number): PixelBuffer { /* branching tectonic scar + uplifted rock */ return new PixelBuffer(56, 52); }`,
  },
  {
    id: 'vfx-firestorm',
    name: 'Огненный Шторм',
    subtitle: 'Спираль пламени, дыма и углей (50×54)',
    kind: 'weather',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 50,
    height: 54,
    frameCount: 12,
    defaultFps: 13,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Клубящаяся шапка полупрозрачного пепла и дыма',
      '1. Спиральный столб живого пламени с белым ядром',
      '2. Восходящий вихрь раскалённых углей',
    ],
    description:
      'Пирокластический вихрь огня: раскалённая спираль пламени выносит светящиеся искры сквозь клубы полупрозрачного дыма.',
    renderFrame: (f, tot) => renderFirestormVfx(f, tot),
    codeSnippet: `function renderFirestormVfx(frame: number, total: number): PixelBuffer { /* helical fire pillar + smoke + embers */ return new PixelBuffer(50, 54); }`,
  },
  {
    id: 'vfx-arcane-aurora',
    name: 'Северное и Магическое Сияние',
    subtitle: 'Завесы энергии K1/K2 и звёзды (52×54)',
    kind: 'weather',
    tier: 'III',
    faction: 'Цитадель',
    width: 52,
    height: 54,
    frameCount: 16,
    defaultFps: 11,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Волновые вертикальные ленты сияния (K1/K2/Emerald)',
      '1. Плавное затухание прозрачности вверх',
      '2. Восходящие звёздные искры маны',
    ],
    description:
      'Атмосферный магический эффект: переливающиеся занавеси полярного сияния, откликающиеся на перекраску державы K1/K2.',
    renderFrame: (f, tot) => renderAuroraVfx(f, tot),
    codeSnippet: `function renderAuroraVfx(frame: number, total: number): PixelBuffer { /* K1/K2/emerald shimmering curtains */ return new PixelBuffer(52, 54); }`,
  },
  {
    id: 'vfx-water-geyser',
    name: 'Водяной Гейзер и Пена',
    subtitle: 'Пульсирующий столб воды и брызги (50×54)',
    kind: 'weather',
    tier: 'II',
    faction: 'Гильдия',
    width: 50,
    height: 54,
    frameCount: 16,
    defaultFps: 13,
    noOutlineRequired: true,
    supportsShadow: false,
    layersSpec: [
      '0. Каменное жерло источника',
      '1. Пульсирующий напорный столб воды с белой пеной',
      '2. Паровая шапка и разлетающиеся капли по параболе',
    ],
    description:
      'Гидротермальный эффект гейзера: циклический выброс воды и пены с баллистическим разлётом капель.',
    renderFrame: (f, tot) => renderWaterGeyserVfx(f, tot),
    codeSnippet: `function renderWaterGeyserVfx(frame: number, total: number): PixelBuffer { /* pressurized water jet + foam droplets */ return new PixelBuffer(50, 54); }`,
  },
];
