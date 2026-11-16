import { RAMPS, VOID } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { UnitFrameAnchors } from '../engine/unitAssembler';
import {
  clipToSwimUpperBody,
  drawCurvedHorn,
  drawShadedLimb,
  finalizeEraCreatureAction,
  getEraModeAction,
  getWalkCycle,
  pickTopLeftTone,
} from './eraCreatureHelpers';
import { PixelModelDef, RenderContextOptions } from './types';

function makePrimordialAnchors(cx: number, pivotY: number, headX: number, headY: number): UnitFrameAnchors {
  return {
    head: { x: headX - 2, y: headY - 2, w: 4, h: 4 },
    item: { x: headX - 5, y: headY, w: 3, h: 3 },
    pivot: { x: cx, y: pivotY },
  };
}

/**
 * 1. Трилобит (Trilobite, 42×26, Tier I, 12f)
 * Cambrian three-lobed armored marine arthropod with compound eyes & spine ram
 */
function renderTrilobite(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(42, 26);
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const curlShift = isAtk ? Math.round(Math.sin(phase * Math.PI) * 3) : 0;
  const cx = 22 - (isAtk && phase > 0.35 && phase < 0.72 ? 3 : 0);
  const cy = 15 + bounceY + (mode === 'swim' ? 2 : 0) - curlShift;

  // Undulating Cambrian biramous appendages beneath carapace
  buf.layer((sub) => {
    for (let i = 0; i < 6; i++) {
      const lx = cx - 6 + i * 3;
      const sway = Math.round(Math.sin(phase * Math.PI * 2 + i * 0.9) * (legSwing !== 0 ? 1.5 : 0.4));
      sub.drawLine(lx, cy + 3, lx + sway, Math.min(23, cy + 7), RAMPS.timber.mid, 1);
      sub.setPixel(lx + sway, Math.min(23, cy + 7), RAMPS.sandstone.highlight);
    }
  });

  // Pygidium tail shield & 6 segmented thoracic pleurae with sharp lateral spines
  buf.layer((sub) => {
    for (let s = 5; s >= 0; s--) {
      const sx = cx - 2 + s * 2.5;
      const rx = 2.6;
      const ry = 4.8 - s * 0.42;
      sub.fillEllipse(sx, cy, rx, ry, (nx, ny) => {
        if (Math.abs(ny) < 0.25 && s % 2 === 0) return RAMPS.magenta.mid; // axial lobe K1 stripe
        return pickTopLeftTone(nx, ny, RAMPS.autumn);
      });
      // Pleural side spines
      if (appLevel >= 1) {
        sub.drawLine(Math.round(sx + 1), Math.round(cy - ry + 1), Math.round(sx + 3), Math.round(cy - ry - 1), RAMPS.bone.mid, 1);
      }
      if (appLevel === 2 && s % 2 === 0) {
        sub.setPixel(Math.round(sx), Math.round(cy - ry - 1), RAMPS.cyanMask.highlight);
      }
    }
  });

  // Sculpted horseshoe cephalon head shield, glabella & compound eye crescents
  buf.layer((sub) => {
    sub.fillEllipse(cx - 7, cy, 5.4, 5.2, (nx, ny) => {
      if (nx < -0.35 && Math.abs(ny) < 0.35) return RAMPS.autumn.highlight;
      return pickTopLeftTone(nx, ny, RAMPS.autumn);
    });
    // Raised compound eye ridge & glowing Cambrian K2 ocelli
    sub.fillRect(cx - 9, cy - 3, 2, 2, RAMPS.cyanMask.highlight);
    sub.fillRect(cx - 9, cy + 1, 2, 2, RAMPS.cyanMask.mid);
    // Genal corner spikes sweeping back along cheeks
    drawCurvedHorn(sub, cx - 5, cy - 4, cx + 2, cy - 6, cx - 1, cy - 6, 1.1, RAMPS.bone);
    // Short sensory antennae
    sub.drawLine(cx - 12, cy - 1, cx - 16, cy - 3 + Math.round(Math.sin(phase * Math.PI * 2)), RAMPS.sandstone.highlight, 1);
    sub.drawLine(cx - 12, cy + 1, cx - 16, cy + 3 - Math.round(Math.sin(phase * Math.PI * 2)), RAMPS.sandstone.mid, 1);
  });

  if (isAtk && phase >= 0.35 && phase <= 0.72) {
    buf.drawLine(cx - 16, cy - 3, cx - 18, cy + 3, '#FFFFFF', 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 18, 4, 38, frame);
  return finalizeEraCreatureAction(buf, frame, total, cx, 21, action);
}

/**
 * 2. Меганевра (Meganeura, 48×36, Tier II, 12f)
 * Giant Carboniferous griffinfly with 4 translucent beating wings & talon dive
 */
function renderMeganeura(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(48, 36);
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const wingBeat = Math.sin(phase * Math.PI * 6);
  const diveX = isAtk ? (phase < 0.35 ? 3 : phase < 0.7 ? -6 : -1) : 0;
  const diveY = isAtk ? (phase < 0.35 ? -3 : phase < 0.7 ? 4 : 0) : 0;
  const cx = 22 + diveX;
  const cy = 17 + bounceY + diveY + (mode === 'swim' ? 3 : 0);

  // Back wing pair (translucent ice-blue veined membranes)
  buf.layer((sub) => {
    const lift = Math.round(wingBeat * 5);
    sub.drawRotatedRect(cx + 2, cy - 2, 13, 2.2, -0.7 + wingBeat * 0.28, (u, v) =>
      Math.abs(v) > 0.7 ? RAMPS.ice.highlight : '#9EDBF2A8'
    );
    sub.drawRotatedRect(cx + 5, cy - 1, 11, 2.0, -0.45 - wingBeat * 0.22, (u, v) =>
      Math.abs(v) > 0.7 ? RAMPS.cyanMask.mid : '#C2F0FF98'
    );
    if (lift > 0) sub.setPixel(cx + 10, Math.max(2, cy - 8), '#FFFFFF');
  });

  // Segmented slender abdomen + muscular emerald thorax + gripping forelegs
  buf.layer((sub) => {
    for (let i = 0; i < 11; i++) {
      const ax = cx + 5 + i * 1.6;
      const ay = cy + Math.round(Math.sin(phase * Math.PI * 2 + i * 0.3) * 0.8 + i * 0.15);
      sub.fillEllipse(ax, ay, 1.5, 1.4 - i * 0.04, (nx, ny) => {
        if (i % 2 === 0 && ny < 0) return RAMPS.magenta.mid;
        return pickTopLeftTone(nx, ny, RAMPS.emerald);
      });
    }
    // Muscular thorax barrel
    sub.fillEllipse(cx, cy, 4.6, 3.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.emerald));
    // Six bristling predatory legs tucked underneath for airborne grabs
    for (let l = 0; l < 3; l++) {
      const reach = isAtk && phase >= 0.3 && phase < 0.75 ? -3 : 0;
      sub.drawLine(cx - 2 + l * 2, cy + 2, cx - 5 + l * 2 + reach, cy + 8, RAMPS.timber.mid, 1);
    }
  });

  // Front wing pair + huge compound eyes + snapping mandibles
  buf.layer((sub) => {
    sub.drawRotatedRect(cx, cy - 1, 14, 2.4, -0.95 - wingBeat * 0.35, (u, v) =>
      Math.abs(v) > 0.75 ? RAMPS.cyanMask.highlight : '#D8F6FFB8'
    );
    // Head + giant multifaceted compound eyes
    sub.fillEllipse(cx - 5, cy - 1, 3.2, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.emerald));
    sub.fillEllipse(cx - 6, cy - 2, 1.8, 1.8, RAMPS.gold.highlight);
    sub.setPixel(cx - 7, cy - 2, VOID);
    // Ornamented cephalic crest for ornate genes
    if (appLevel === 2) {
      sub.drawLine(cx - 4, cy - 4, cx, cy - 6, RAMPS.magenta.highlight, 1);
    }
    // Sharp forward mandibles
    const snap = isAtk && phase >= 0.35 && phase < 0.7 ? 2 : 0;
    sub.drawLine(cx - 7, cy + 1, cx - 10, cy + 1 + snap, RAMPS.bone.highlight, 1);
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 22, 5, 42, frame);
  return finalizeEraCreatureAction(buf, frame, total, cx, 26, action);
}

/**
 * 3. Артроплевра (Arthropleura, 58×30, Tier II, 16f)
 * Giant 2.5m Carboniferous millipede with 12 articulating armored tergite segments
 */
function renderArthropleura(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(58, 30);
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const rearBoost = isAtk ? Math.sin(phase * Math.PI) * 5 : 0;
  const baseX = 11 - (isAtk && phase >= 0.35 && phase < 0.7 ? 3 : 0);
  const baseY = 18 + (mode === 'swim' ? 2 : 0);

  // Metachronal wave of chitinous walking legs
  buf.layer((sub) => {
    for (let i = 0; i < 12; i++) {
      const lx = Math.min(54, baseX + 3 + i * 3.5);
      const lift = i < 4 ? Math.round(rearBoost * (1 - i * 0.25)) : 0;
      const ly = baseY - lift + bounceY;
      const step = Math.round(Math.sin(phase * Math.PI * 2 + i * 0.85) * 1.5);
      sub.drawLine(lx, ly + 2, lx + step, Math.min(27, ly + 6), RAMPS.timber.mid, 1);
      sub.setPixel(lx + step, Math.min(27, ly + 6), RAMPS.gold.mid);
    }
  });

  // 12 articulating overlapping broad carapace tergite plates
  buf.layer((sub) => {
    for (let s = 11; s >= 0; s--) {
      const sx = Math.min(53, baseX + 3 + s * 3.5);
      const lift = s < 5 ? Math.round(rearBoost * (1 - s * 0.2)) : 0;
      const waveY = Math.round(Math.sin(phase * Math.PI * 2 - s * 0.45) * 1.1);
      const sy = baseY - lift + waveY + bounceY;
      const r = s > 9 ? 3.2 : 4.2;
      sub.fillEllipse(sx, sy, 2.8, r, (nx, ny) => {
        if (Math.abs(ny + 0.1) < 0.22 && s % 2 === 0) return RAMPS.magenta.mid;
        return pickTopLeftTone(nx, ny, RAMPS.timber);
      });
      // Polished bronze keel edge + optional spiky dorsal margin
      sub.setPixel(Math.round(sx), Math.round(sy - r), RAMPS.gold.highlight);
      if (appLevel === 2 && s % 3 === 1) {
        sub.setPixel(Math.round(sx + 1), Math.round(sy - r - 1), RAMPS.cyanMask.highlight);
      }
    }
  });

  // Sculpted armored millipede head, antennae & biting mandibles
  buf.layer((sub) => {
    const headY = baseY - Math.round(rearBoost) + bounceY;
    sub.fillEllipse(baseX, headY, 4.2, 4.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
    sub.fillRect(baseX - 2, headY - 2, 2, 2, RAMPS.cyanMask.highlight);
    sub.setPixel(baseX - 2, headY - 2, VOID);
    const antWave = Math.round(Math.sin(phase * Math.PI * 4) * 1.5);
    sub.drawLine(baseX - 3, headY - 2, baseX - 8, Math.max(2, headY - 5 + antWave), RAMPS.gold.mid, 1);
    sub.drawLine(baseX - 3, headY + 1, baseX - 8, Math.max(3, headY - 1 - antWave), RAMPS.gold.shadow, 1);
  });

  if (isAtk && phase >= 0.35 && phase < 0.72) {
    buf.drawLine(baseX - 5, baseY - 2, baseX - 7, baseY + 4, '#FFFFFF', 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 20, 4, 54, frame);
  return finalizeEraCreatureAction(buf, frame, total, 29, 25, action);
}

/**
 * 4. Эриопс / Диплокаулус (Diplocaulus, 46×30, Tier I, 12f)
 * Permian boomerang-headed amphibian with webbed tail paddle & mottled mossy skin
 */
function renderDiplocaulus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(46, 30);
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const lunge = isAtk ? (phase < 0.35 ? 2 : phase < 0.7 ? -5 : -1) : 0;
  const cx = 22 + lunge;
  const cy = 18 + bounceY + (mode === 'swim' ? 2 : 0);

  // Tapered swimming tail + splayed amphibian back legs
  buf.layer((sub) => {
    for (let i = 0; i < 12; i++) {
      const tx = cx + 6 + i * 1.3;
      const ty = cy + Math.round(Math.sin(phase * Math.PI * 2 - i * 0.45) * 1.8);
      const r = Math.max(1.1, 3.0 - i * 0.16);
      sub.fillEllipse(tx, ty, 1.5, r, (nx, ny) => {
        if (ny < -0.4 && i % 2 === 0) return RAMPS.cyanMask.mid; // fin crest
        return pickTopLeftTone(nx, ny, RAMPS.moss);
      });
    }
    if (mode === 'walk') {
      drawShadedLimb(sub, cx - 2, cy + 2, cx - 3 + legSwing, 26, 1.3, RAMPS.moss);
      drawShadedLimb(sub, cx + 6, cy + 2, cx + 6 - legSwing, 26, 1.3, RAMPS.moss);
    }
  });

  // Broad flat amphibian body + boomerang-shaped horned head
  buf.layer((sub) => {
    sub.fillEllipse(cx + 1, cy, 7.2, 4.0, (nx, ny, px, py) => {
      if (ny > 0.35) return RAMPS.sandstone.mid;
      if ((px + py) % 5 === 0) return RAMPS.moss.shadow; // amphibian mottling
      return pickTopLeftTone(nx, ny, RAMPS.moss);
    });
    // Boomerang cranial horns sweeping symmetrically back and outward
    drawCurvedHorn(sub, cx - 8, cy - 1, cx - 1, cy - 8, cx - 6, cy - 6, 2.0, RAMPS.moss);
    if (appLevel >= 1) {
      sub.drawLine(cx - 7, cy - 2, cx - 2, cy - 7, RAMPS.magenta.highlight, 1);
    }
    // Wide snout facing left + upward-looking eyes
    sub.fillEllipse(cx - 8, cy, 4.6, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.moss));
    sub.fillRect(cx - 10, cy - 2, 2, 2, RAMPS.gold.highlight);
    sub.setPixel(cx - 10, cy - 2, VOID);
    if (appLevel === 2) {
      sub.setPixel(cx - 3, cy - 8, RAMPS.cyanMask.highlight);
    }
  });

  if (isAtk && phase >= 0.35 && phase < 0.72) {
    buf.drawLine(cx - 13, cy - 3, cx - 15, cy + 3, '#FFFFFF', 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 20, 4, 42, frame);
  return finalizeEraCreatureAction(buf, frame, total, cx, 26, action);
}

export const ERA_PRIMORDIAL_MODELS: PixelModelDef[] = [
  {
    id: 'trilobite',
    name: 'Трилобит',
    subtitle: 'Кембрийский панцирный членистоногий (42×26)',
    kind: 'unit',
    tier: 'I',
    era: 'primordial',
    entityType: 'creature',
    faction: 'Лесной Круг',
    width: 42,
    height: 26,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Удар панцирным щитом',
    layersSpec: ['1. Двуветвистые ножки', '2. Шесть плевральных щитков', '3. Головной щит-цефалон и фасеточные глаза'],
    description: 'Древнейшее морское существо кембрия с трёхдольным панцирем и биолюминесцентными отметками.',
    unitMeta: { coreSize: '42×26 палеозой', usesSkinMask: false, supportsSwim: true, supportsActions: true, shadowWidth: 12, supportsGenes: true },
    renderFrame: renderTrilobite,
    getAnchors: () => makePrimordialAnchors(22, 21, 14, 14),
    codeSnippet: '// Procedural Cambrian Trilobite — zero black contours, 4-tone shell',
  },
  {
    id: 'meganeura',
    name: 'Меганевра',
    subtitle: 'Гигантская стрекоза карбона (48×36)',
    kind: 'unit',
    tier: 'II',
    era: 'primordial',
    entityType: 'creature',
    faction: 'Лесной Круг',
    width: 48,
    height: 36,
    frameCount: 12,
    defaultFps: 12,
    attackName: 'Пике и хват жвалами',
    layersSpec: ['1. Задняя пара жилкованных крыльев', '2. Сегментированное брюшко и лапы', '3. Передние крылья и фасеточные глаза'],
    description: 'Гигантская палеозойская стрекоза с размахом прозрачных крыльев и хищными жвалами.',
    unitMeta: { coreSize: '48×36 палеозой', usesSkinMask: false, supportsSwim: true, supportsActions: true, shadowWidth: 11, supportsGenes: true },
    renderFrame: renderMeganeura,
    getAnchors: () => makePrimordialAnchors(22, 26, 16, 15),
    codeSnippet: '// Procedural Carboniferous Meganeura — beating translucent wings',
  },
  {
    id: 'arthropleura',
    name: 'Артроплевра',
    subtitle: 'Гигантская многоножка карбона (58×30)',
    kind: 'unit',
    tier: 'II',
    era: 'primordial',
    entityType: 'creature',
    faction: 'Орда',
    width: 58,
    height: 30,
    frameCount: 16,
    defaultFps: 11,
    attackName: 'Волна хитинового тарана',
    layersSpec: ['1. Метахронная волна лап', '2. Двенадцать тергитов панциря', '3. Головной щит с антеннами'],
    description: 'Бронированная многоножка длиной более двух метров с волнообразной походкой и янтарным хитином.',
    unitMeta: { coreSize: '58×30 палеозой', usesSkinMask: false, supportsSwim: true, supportsActions: true, shadowWidth: 18, supportsGenes: true },
    renderFrame: renderArthropleura,
    getAnchors: () => makePrimordialAnchors(29, 25, 11, 16),
    codeSnippet: '// Procedural Carboniferous Arthropleura — undulating armor segments',
  },
  {
    id: 'diplocaulus',
    name: 'Диплокаулус',
    subtitle: 'Первая пермская амфибия-бумеранг (46×30)',
    kind: 'unit',
    tier: 'I',
    era: 'primordial',
    entityType: 'creature',
    faction: 'Лесной Круг',
    width: 46,
    height: 30,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Бросок головой-бумерангом',
    layersSpec: ['1. Веслообразный хвост и лапы', '2. Пятнистое тело амфибии', '3. Рогатый череп-бумеранг'],
    description: 'Древняя полуводная амфибия с широким черепом-бумерангом и гребным хвостом.',
    unitMeta: { coreSize: '46×30 палеозой', usesSkinMask: false, supportsSwim: true, supportsActions: true, shadowWidth: 13, supportsGenes: true },
    renderFrame: renderDiplocaulus,
    getAnchors: () => makePrimordialAnchors(22, 26, 13, 17),
    codeSnippet: '// Procedural Permian Diplocaulus — boomerang cranial crests',
  },
];
