import { MaterialRamp, RAMPS } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef, RenderContextOptions } from './types';
import {
  clipToSwimUpperBody,
  drawCurvedHorn,
  drawShadedLimb,
  finalizeEraCreatureAction,
  getEraModeAction,
  getWalkCycle,
  pickTopLeftTone,
} from './eraCreatureHelpers';

const FUR_MAMMOTH: MaterialRamp = {
  id: 'fur_mammoth',
  name: 'Шерсть мамонта',
  role: 'Woolly fur',
  deep: '#382014',
  shadow: '#5A3422',
  mid: '#824E35',
  highlight: '#AD7050',
};

const FUR_RHINO: MaterialRamp = {
  id: 'fur_rhino',
  name: 'Дымчатый мех',
  role: 'Woolly rhino coat',
  deep: '#2F2D33',
  shadow: '#4B4752',
  mid: '#6D6878',
  highlight: '#9690A3',
};

const FUR_SABER: MaterialRamp = {
  id: 'fur_saber',
  name: 'Золотистый мех',
  role: 'Sabertooth coat',
  deep: '#5C3A16',
  shadow: '#8A5922',
  mid: '#BA8036',
  highlight: '#E3AD5B',
};

const FUR_BEAR: MaterialRamp = {
  id: 'fur_bear',
  name: 'Бурый мех',
  role: 'Cave bear coat',
  deep: '#241814',
  shadow: '#3E2921',
  mid: '#5E4033',
  highlight: '#825D4D',
};

const FUR_STAG: MaterialRamp = {
  id: 'fur_stag',
  name: 'Олений мех',
  role: 'Giant deer coat',
  deep: '#473020',
  shadow: '#6E4C34',
  mid: '#9A6E4D',
  highlight: '#C49672',
};

// 1. Woolly Mammoth (64×52, Tier III Giant)
function renderMammoth(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(64, 52);
  const cx = 36;
  const cy = 27 + bounceY + (mode === 'swim' ? 6 : 0);

  // Shaggy tufted tail
  buf.drawLine(cx + 12, cy - 2, cx + 16, cy + 5, FUR_MAMMOTH.shadow, 2);
  buf.setPixel(cx + 16, cy + 6, FUR_MAMMOTH.deep);
  buf.setPixel(cx + 17, cy + 6, FUR_MAMMOTH.deep);

  // Far jointed pillar legs with ankle cushions & ivory toenails
  if (mode !== 'swim') {
    const fl = -legSwing * 0.9;
    const hl = legSwing * 0.9;
    drawShadedLimb(buf, cx - 7, cy + 6, cx - 8 + fl * 0.4, cy + 12, 3.5, FUR_MAMMOTH);
    drawShadedLimb(buf, cx - 8 + fl * 0.4, cy + 12, cx - 8 + fl, 47, 3.0, FUR_MAMMOTH);
    buf.fillEllipse(cx - 8 + fl, 47, 3.3, 1.4, FUR_MAMMOTH.deep);

    drawShadedLimb(buf, cx + 6, cy + 6, cx + 8 + hl * 0.4, cy + 12, 3.4, FUR_MAMMOTH);
    drawShadedLimb(buf, cx + 8 + hl * 0.4, cy + 12, cx + 7 + hl, 47, 2.9, FUR_MAMMOTH);
    buf.fillEllipse(cx + 7 + hl, 47, 3.1, 1.4, FUR_MAMMOTH.deep);
  }

  // Shaggy torso + sloped hindquarters + tufted fur locks + optional glacial frost + K1/K2 blanket
  const isGlacial = ctx?.genes?.biomeTint === 'tundra' || ctx?.genes?.coat === 'albino';
  buf.layer((sub) => {
    sub.fillEllipse(cx + 2, cy + 1, 13.5, 10.0, (nx, ny) => {
      if (isGlacial && ny < -0.52) return (nx + ny) % 0.3 < 0 ? RAMPS.ice.highlight : RAMPS.ice.mid;
      return pickTopLeftTone(nx, ny, FUR_MAMMOTH);
    });
    sub.fillEllipse(cx - 5, cy - 3, 9.5, 8.8, (nx, ny) => {
      if (isGlacial && ny < -0.45) return RAMPS.ice.highlight;
      return pickTopLeftTone(nx, ny, FUR_MAMMOTH);
    });
    // Tapered shaggy fur tufts along belly skirt (organic wavy fringe instead of stick lines)
    for (let x = cx - 9; x <= cx + 11; x += 3) {
      const tuftLen = ((x + 3) % 2) + 2;
      sub.fillEllipse(x, cy + 9 + tuftLen * 0.3, 1.6, tuftLen * 0.75, FUR_MAMMOTH.deep);
      sub.setPixel(x - 1, cy + 9, FUR_MAMMOTH.shadow);
    }
    // K1/K2 contoured draped war-blanket with bone clasp & K2 fringe
    for (let dy = -6; dy <= 1; dy++) {
      const halfW = 5 + Math.round((dy + 6) * 0.45);
      for (let dx = -halfW; dx <= halfW; dx++) {
        const col =
          dy === 1
            ? (dx % 2 === 0 ? RAMPS.cyanMask.highlight : RAMPS.cyanMask.mid)
            : dy <= -4
              ? RAMPS.magenta.highlight
              : dx > 3
                ? RAMPS.magenta.shadow
                : RAMPS.magenta.mid;
        sub.setPixel(cx + 1 + dx, cy - 2 + dy, col);
      }
    }
    sub.setPixel(cx - 2, cy - 5, RAMPS.bone.highlight);
  });

  // Near muscular jointed legs with knees, cushioned soles & 2 ivory toenails
  if (mode !== 'swim') {
    buf.layer((sub) => {
      const stompY = isAtk && phase < 0.45 ? -4 : 0;
      const fl = legSwing;
      const hl = -legSwing;
      drawShadedLimb(sub, cx - 8, cy + 5, cx - 9 + fl * 0.4, cy + 12 + stompY * 0.5, 3.7, FUR_MAMMOTH);
      drawShadedLimb(sub, cx - 9 + fl * 0.4, cy + 12 + stompY * 0.5, cx - 9 + fl, 47 + stompY, 3.2, FUR_MAMMOTH);
      sub.fillEllipse(cx - 9 + fl, 47 + stompY, 3.5, 1.5, FUR_MAMMOTH.shadow);
      sub.setPixel(Math.round(cx - 11 + fl), 48 + stompY, RAMPS.bone.highlight);
      sub.setPixel(Math.round(cx - 9 + fl), 48 + stompY, RAMPS.bone.mid);

      drawShadedLimb(sub, cx + 5, cy + 5, cx + 6 + hl * 0.4, cy + 12, 3.5, FUR_MAMMOTH);
      drawShadedLimb(sub, cx + 6 + hl * 0.4, cy + 12, cx + 5 + hl, 47, 3.1, FUR_MAMMOTH);
      sub.fillEllipse(cx + 5 + hl, 47, 3.3, 1.5, FUR_MAMMOTH.shadow);
      sub.setPixel(Math.round(cx + 3 + hl), 48, RAMPS.bone.highlight);
      sub.setPixel(Math.round(cx + 5 + hl), 48, RAMPS.bone.mid);
    });
  }

  // High domed crown + sculpted ear flap + wrinkled prehensile trunk + sweeping ivory tusks
  buf.layer((sub) => {
    const hx = cx - 13;
    const hy = cy - 6;
    sub.fillEllipse(hx, hy, 6.4, 6.8, (nx, ny) => pickTopLeftTone(nx, ny, FUR_MAMMOTH));
    sub.fillEllipse(hx + 1, hy - 5, 4.3, 3.6, (nx, ny) => pickTopLeftTone(nx, ny, FUR_MAMMOTH)); // crown dome
    sub.fillEllipse(hx + 4, hy - 1, 2.3, 3.4, FUR_MAMMOTH.shadow); // shaded mammoth ear flap
    sub.setPixel(hx - 2, hy - 1, '#D9A040');

    // Muscular trunk with curved highlight & curled prehensile tip
    const trunkLift = isAtk ? (phase < 0.35 ? -8 : phase < 0.7 ? 5 : 0) : Math.sin(phase * Math.PI * 2) * 2;
    const tipX = hx - 9 - (isAtk && phase >= 0.35 && phase < 0.7 ? 4 : 0);
    const tipY = hy + 13 + trunkLift;
    drawCurvedHorn(sub, hx - 4, hy + 2, tipX, tipY, hx - 9, hy + 7 + trunkLift * 0.5, 2.3, FUR_MAMMOTH);
    sub.setPixel(Math.round(tipX) + 1, Math.round(tipY) - 1, FUR_MAMMOTH.highlight);

    // Sweeping ivory tusks controlled by appendage genes
    if (appLevel >= 1) {
      const tuskSpan = appLevel === 2 ? 16 : 11;
      drawCurvedHorn(
        sub,
        hx - 3,
        hy + 4,
        hx - 3 - tuskSpan,
        hy - 2 - (appLevel === 2 ? 3 : 0),
        hx - 11,
        hy + 10,
        1.7,
        RAMPS.bone
      );
      if (appLevel === 2) {
        sub.setPixel(hx - 9, hy + 5, RAMPS.gold.highlight);
        sub.setPixel(hx - 13, hy + 3, RAMPS.gold.mid);
      }
    }
  });

  if (isAtk && phase >= 0.42 && phase < 0.75) {
    buf.drawLine(cx - 25, cy + 10, cx - 18, cy + 12, '#FFFFFF', 1);
  }
  if (mode === 'swim') clipToSwimUpperBody(buf, 31, 6, 56, frame);
  return finalizeEraCreatureAction(buf, frame, total, 34, 38, action);
}

// 2. Woolly Rhino (44×30, Tier II)
function renderWoollyRhino(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const lungeX = isAtk ? (phase < 0.35 ? 2 : phase < 0.7 ? -4 : 0) : 0;

  const buf = new PixelBuffer(44, 30);
  const cx = 24 + lungeX;
  const cy = 16 + bounceY + (mode === 'swim' ? 3 : 0);

  if (mode !== 'swim') {
    const fl = -legSwing * 0.9;
    const hl = legSwing * 0.9;
    drawShadedLimb(buf, cx - 6, cy + 3, cx - 7 + fl * 0.5, cy + 6, 2.2, FUR_RHINO);
    drawShadedLimb(buf, cx - 7 + fl * 0.5, cy + 6, cx - 7 + fl, 26, 1.9, FUR_RHINO);
    buf.setPixel(Math.round(cx - 8 + fl), 26, RAMPS.bone.mid);
    drawShadedLimb(buf, cx + 6, cy + 3, cx + 7 + hl * 0.5, cy + 6, 2.2, FUR_RHINO);
    drawShadedLimb(buf, cx + 7 + hl * 0.5, cy + 6, cx + 7 + hl, 26, 1.9, FUR_RHINO);
    buf.setPixel(Math.round(cx + 6 + hl), 26, RAMPS.bone.mid);
  }

  buf.layer((sub) => {
    sub.fillEllipse(cx + 1, cy, 10.4, 6.0, (nx, ny) => pickTopLeftTone(nx, ny, FUR_RHINO));
    sub.fillEllipse(cx - 5, cy - 3, 5.4, 4.5, (nx, ny) => pickTopLeftTone(nx, ny, FUR_RHINO));
    for (let x = cx - 5; x <= cx + 6; x += 3) {
      sub.fillEllipse(x, cy + 6, 1.3, 1.0, FUR_RHINO.deep);
    }
    for (let dy = -4; dy <= 0; dy++) {
      const halfW = 3 + Math.round((dy + 4) * 0.5);
      for (let dx = -halfW; dx <= halfW; dx++) {
        const col =
          dy === 0
            ? RAMPS.cyanMask.mid
            : dy <= -3
              ? RAMPS.magenta.highlight
              : dx > 2
                ? RAMPS.magenta.shadow
                : RAMPS.magenta.mid;
        sub.setPixel(cx + 2 + dx, cy - 1 + dy, col);
      }
    }
  });

  if (mode !== 'swim') {
    buf.layer((sub) => {
      const fl = legSwing;
      const hl = -legSwing;
      drawShadedLimb(sub, cx - 4, cy + 3, cx - 5 + fl * 0.5, cy + 6, 2.2, FUR_RHINO);
      drawShadedLimb(sub, cx - 5 + fl * 0.5, cy + 6, cx - 4 + fl, 26, 1.9, FUR_RHINO);
      sub.setPixel(Math.round(cx - 5 + fl), 26, RAMPS.bone.highlight);
      drawShadedLimb(sub, cx + 5, cy + 3, cx + 6 + hl * 0.5, cy + 6, 2.1, FUR_RHINO);
      drawShadedLimb(sub, cx + 6 + hl * 0.5, cy + 6, cx + 5 + hl, 26, 1.8, FUR_RHINO);
      sub.setPixel(Math.round(cx + 4 + hl), 26, RAMPS.bone.highlight);
    });
  }

  // Lowered heavy head, furry ears + giant flattened blade horn
  buf.layer((sub) => {
    const pitchY = isAtk && phase >= 0.3 && phase < 0.7 ? 2 : 0;
    const hx = cx - 10;
    const hy = cy + 1 + pitchY;
    sub.fillEllipse(hx, hy, 4.9, 3.4, (nx, ny) => pickTopLeftTone(nx, ny, FUR_RHINO));
    sub.setPixel(hx + 2, hy - 3, FUR_RHINO.shadow);
    sub.setPixel(hx - 1, hy - 1, '#583A2E');
    if (appLevel >= 1) {
      const tipX = hx - (appLevel === 2 ? 9 : 7);
      const tipY = hy - (appLevel === 2 ? 7 : 5);
      drawCurvedHorn(sub, hx - 3, hy, tipX, tipY, hx - 6, hy - 2, 1.5, RAMPS.bone);
      drawCurvedHorn(sub, hx, hy - 1, hx - 2, hy - 4, hx - 1, hy - 3, 0.9, RAMPS.bone);
    }
  });

  if (isAtk && phase >= 0.36 && phase < 0.72) {
    buf.drawLine(cx - 19, cy - 4, cx - 21, cy + 2, '#FFFFFF', 1);
  }
  if (mode === 'swim') clipToSwimUpperBody(buf, 18, 4, 38, frame);
  return finalizeEraCreatureAction(buf, frame, total, 23, 21, action);
}

// 3. Sabertooth Smilodon (38×26, Tier II)
function renderSabertooth(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const leapY = isAtk && phase >= 0.3 && phase < 0.68 ? -3 : 0;
  const lungeX = isAtk ? (phase < 0.3 ? 2 : phase < 0.7 ? -4 : 0) : 0;

  const buf = new PixelBuffer(38, 26);
  const cx = 19 + lungeX;
  const cy = 14 + bounceY + leapY + (mode === 'swim' ? 3 : 0);

  // Short bobtail with dark tip
  buf.drawLine(cx + 8, cy - 2, cx + 11, cy - 4, FUR_SABER.mid, 2);
  buf.setPixel(cx + 12, cy - 4, FUR_SABER.deep);

  if (mode !== 'swim') {
    const fl = -legSwing;
    const hl = legSwing;
    drawShadedLimb(buf, cx - 6, cy + 2, cx - 7 + fl * 0.5, cy + 5, 1.5, FUR_SABER);
    drawShadedLimb(buf, cx - 7 + fl * 0.5, cy + 5, cx - 7 + fl, 23, 1.2, FUR_SABER);
    drawShadedLimb(buf, cx + 6, cy + 2, cx + 8 + hl * 0.5, cy + 5, 1.6, FUR_SABER);
    drawShadedLimb(buf, cx + 8 + hl * 0.5, cy + 5, cx + 7 + hl, 23, 1.2, FUR_SABER);
  }

  buf.layer((sub) => {
    sub.fillEllipse(cx + 3, cy - 1, 5.2, 3.3, (nx, ny) => pickTopLeftTone(nx, ny, FUR_SABER));
    sub.fillEllipse(cx - 4, cy - 1, 4.7, 3.9, (nx, ny) => pickTopLeftTone(nx, ny, FUR_SABER));
    sub.drawLine(cx - 7, cy - 3, cx - 6, cy + 2, RAMPS.magenta.mid, 1);
    sub.setPixel(cx - 7, cy, RAMPS.cyanMask.highlight);
  });

  if (mode !== 'swim') {
    buf.layer((sub) => {
      const fl = legSwing;
      const hl = -legSwing;
      drawShadedLimb(sub, cx - 4, cy + 2, cx - 4 + fl * 0.5, cy + 5, 1.6, FUR_SABER);
      drawShadedLimb(sub, cx - 4 + fl * 0.5, cy + 5, cx - 5 + fl, 23, 1.3, FUR_SABER);
      sub.setPixel(Math.round(cx - 6 + fl), 23, RAMPS.bone.highlight);

      drawShadedLimb(sub, cx + 5, cy + 2, cx + 6 + hl * 0.5, cy + 5, 1.6, FUR_SABER);
      drawShadedLimb(sub, cx + 6 + hl * 0.5, cy + 5, cx + 5 + hl, 23, 1.3, FUR_SABER);
      sub.setPixel(Math.round(cx + 4 + hl), 23, RAMPS.bone.highlight);
    });
  }

  // Broad feline head + pale chin + iconic curved saber fangs
  buf.layer((sub) => {
    const hx = cx - 9;
    const hy = cy - 3;
    sub.fillEllipse(hx, hy, 3.7, 3.1, (nx, ny) => pickTopLeftTone(nx, ny, FUR_SABER));
    sub.setPixel(hx - 3, hy, '#D88D6D');
    sub.setPixel(hx - 1, hy - 1, '#EAB308');
    sub.setPixel(hx + 2, hy - 3, FUR_SABER.shadow);
    sub.setPixel(hx + 1, hy - 4, FUR_SABER.highlight);
    if (appLevel >= 1) {
      const fangH = appLevel === 2 ? 5 : 4;
      sub.drawLine(hx - 2, hy + 1, hx - 2, hy + fangH, RAMPS.bone.highlight, 1);
      sub.setPixel(hx - 1, hy + 2, RAMPS.bone.mid);
    }
    if (isAtk && phase >= 0.35 && phase < 0.72) {
      sub.drawLine(hx - 5, hy - 1, hx - 7, hy + 4, '#FFFFFF', 1);
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 16, 4, 34, frame);
  return finalizeEraCreatureAction(buf, frame, total, 19, 19, action);
}

// 4. Cave Bear (44×34, Tier III)
function renderCaveBear(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const rearUp = isAtk && phase >= 0.25 && phase < 0.75;

  const buf = new PixelBuffer(44, 34);
  const cx = 22;
  const cy = (rearUp ? 17 : 20) + bounceY + (mode === 'swim' ? 3 : 0);

  if (mode !== 'swim') {
    const fl = -legSwing;
    const hl = legSwing;
    drawShadedLimb(buf, cx - 5, cy + 3, cx - 6 + fl * 0.5, cy + 7, 2.4, FUR_BEAR);
    drawShadedLimb(buf, cx - 6 + fl * 0.5, cy + 7, cx - 6 + fl, 30, 2.0, FUR_BEAR);
    buf.fillRect(Math.round(cx - 8 + fl), 29, 4, 2, FUR_BEAR.deep);

    drawShadedLimb(buf, cx + 6, cy + 3, cx + 7 + hl * 0.5, cy + 7, 2.4, FUR_BEAR);
    drawShadedLimb(buf, cx + 7 + hl * 0.5, cy + 7, cx + 6 + hl, 30, 2.0, FUR_BEAR);
    buf.fillRect(Math.round(cx + 5 + hl), 29, 4, 2, FUR_BEAR.deep);
  }

  buf.layer((sub) => {
    if (rearUp) {
      sub.fillEllipse(cx + 1, cy + 2, 7.2, 8.8, (nx, ny) => pickTopLeftTone(nx, ny, FUR_BEAR));
      sub.fillEllipse(cx, cy, 4.5, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    } else {
      sub.fillEllipse(cx + 1, cy, 9.8, 5.8, (nx, ny) => pickTopLeftTone(nx, ny, FUR_BEAR));
      sub.fillEllipse(cx - 5, cy - 3, 5.6, 4.4, (nx, ny) => pickTopLeftTone(nx, ny, FUR_BEAR));
      for (let x = cx - 4; x <= cx + 6; x += 3) {
        sub.fillEllipse(x, cy + 6, 1.3, 1.0, FUR_BEAR.deep);
      }
      for (let dy = -4; dy <= -1; dy++) {
        const halfW = 3 + Math.round((dy + 4) * 0.5);
        for (let dx = -halfW; dx <= halfW; dx++) {
          const col = dy === -1 ? RAMPS.cyanMask.mid : dy === -4 ? RAMPS.magenta.highlight : RAMPS.magenta.mid;
          sub.setPixel(cx + 1 + dx, cy + dy, col);
        }
      }
    }
  });

  if (mode !== 'swim') {
    buf.layer((sub) => {
      if (rearUp) {
        drawShadedLimb(sub, cx - 3, cy - 3, cx - 10, cy + 2, 2.2, FUR_BEAR);
        sub.drawLine(cx - 11, cy + 1, cx - 14, cy + 4, RAMPS.bone.highlight, 1);
        sub.drawLine(cx - 12, cy - 1, cx - 15, cy + 2, '#FFFFFF', 1);
      } else {
        const fl = legSwing;
        const hl = -legSwing;
        drawShadedLimb(sub, cx - 4, cy + 3, cx - 5 + fl * 0.5, cy + 7, 2.5, FUR_BEAR);
        drawShadedLimb(sub, cx - 5 + fl * 0.5, cy + 7, cx - 4 + fl, 30, 2.0, FUR_BEAR);
        sub.setPixel(Math.round(cx - 6 + fl), 30, RAMPS.bone.highlight);

        drawShadedLimb(sub, cx + 5, cy + 3, cx + 6 + hl * 0.5, cy + 7, 2.5, FUR_BEAR);
        drawShadedLimb(sub, cx + 6 + hl * 0.5, cy + 7, cx + 5 + hl, 30, 2.0, FUR_BEAR);
        sub.setPixel(Math.round(cx + 3 + hl), 30, RAMPS.bone.highlight);
      }
    });
  }

  // Massive bear head, rounded ears & sculpted muzzle
  buf.layer((sub) => {
    const hx = rearUp ? cx - 3 : cx - 9;
    const hy = rearUp ? cy - 8 : cy - 3;
    sub.fillEllipse(hx, hy, 4.5, 3.8, (nx, ny) => pickTopLeftTone(nx, ny, FUR_BEAR));
    sub.fillEllipse(hx - 3, hy + 1, 2.2, 1.5, FUR_BEAR.highlight);
    sub.setPixel(hx - 5, hy + 1, '#4A362E');
    sub.setPixel(hx - 1, hy - 1, '#EAB308');
    sub.fillEllipse(hx + 2, hy - 4, 1.4, 1.3, FUR_BEAR.shadow);
    sub.fillEllipse(hx - 2, hy - 4, 1.2, 1.1, FUR_BEAR.mid);
    if (appLevel === 2) {
      sub.drawLine(hx + 3, hy + 3, hx + 6, hy, RAMPS.bone.highlight, 1);
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 22, 5, 39, frame);
  return finalizeEraCreatureAction(buf, frame, total, 22, 25, action);
}

// 5. Giant Deer Megaloceros (46×38, Tier II)
function renderGiantDeer(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const chargeX = isAtk ? (phase < 0.35 ? 2 : phase < 0.7 ? -4 : 0) : 0;

  const buf = new PixelBuffer(46, 38);
  const cx = 24 + chargeX;
  const cy = 22 + bounceY + (mode === 'swim' ? 4 : 0);

  if (mode !== 'swim') {
    const fl = -legSwing * 1.1;
    const hl = legSwing * 1.1;
    drawShadedLimb(buf, cx - 5, cy + 3, cx - 6 + fl * 0.5, cy + 7, 1.4, FUR_STAG);
    drawShadedLimb(buf, cx - 6 + fl * 0.5, cy + 7, cx - 6 + fl, 34, 1.0, FUR_STAG);
    buf.setPixel(Math.round(cx - 6 + fl), 34, '#3E3631');

    drawShadedLimb(buf, cx + 5, cy + 3, cx + 7 + hl * 0.5, cy + 7, 1.4, FUR_STAG);
    drawShadedLimb(buf, cx + 7 + hl * 0.5, cy + 7, cx + 6 + hl, 34, 1.0, FUR_STAG);
    buf.setPixel(Math.round(cx + 6 + hl), 34, '#3E3631');
  }

  buf.layer((sub) => {
    sub.fillEllipse(cx + 1, cy, 8.2, 4.4, (nx, ny) => pickTopLeftTone(nx, ny, FUR_STAG));
    sub.fillEllipse(cx + 1, cy - 2, 4.4, 2.4, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, cy - 1, cx + 4, cy - 1, RAMPS.cyanMask.mid, 1);
  });

  if (mode !== 'swim') {
    buf.layer((sub) => {
      const fl = legSwing * 1.1;
      const hl = -legSwing * 1.1;
      drawShadedLimb(sub, cx - 4, cy + 3, cx - 5 + fl * 0.5, cy + 7, 1.4, FUR_STAG);
      drawShadedLimb(sub, cx - 5 + fl * 0.5, cy + 7, cx - 4 + fl, 34, 1.0, FUR_STAG);
      sub.setPixel(Math.round(cx - 4 + fl), 34, '#4A403A');

      drawShadedLimb(sub, cx + 4, cy + 3, cx + 5 + hl * 0.5, cy + 7, 1.4, FUR_STAG);
      drawShadedLimb(sub, cx + 5 + hl * 0.5, cy + 7, cx + 4 + hl, 34, 1.0, FUR_STAG);
      sub.setPixel(Math.round(cx + 4 + hl), 34, '#4A403A');
    });
  }

  // Proud upright neck, alert ear, head & colossal palmate antlers
  buf.layer((sub) => {
    const pitch = isAtk && phase >= 0.32 && phase < 0.7 ? 3 : 0;
    const hx = cx - 9 - pitch * 0.5;
    const hy = cy - 7 + pitch;
    drawShadedLimb(sub, cx - 5, cy - 1, hx + 2, hy + 2, 2.1, FUR_STAG);
    sub.fillEllipse(hx, hy, 3.6, 2.1, (nx, ny) => pickTopLeftTone(nx, ny, FUR_STAG));
    sub.setPixel(hx - 1, hy - 1, '#583A2E');
    sub.setPixel(hx + 3, hy - 2, FUR_STAG.highlight);

    if (appLevel >= 1) {
      const span = appLevel === 2 ? 12 : 9;
      drawCurvedHorn(sub, hx + 1, hy - 2, hx + 5 + span * 0.5, hy - 11, hx + 4, hy - 8, 1.3, RAMPS.bone);
      drawCurvedHorn(sub, hx + 1, hy - 2, hx - 5, hy - 9, hx - 2, hy - 7, 1.2, RAMPS.bone);
      if (appLevel === 2) {
        sub.drawLine(hx + 3, hy - 7, hx + 1, hy - 12, RAMPS.bone.highlight, 1);
        sub.drawLine(hx - 2, hy - 6, hx - 7, hy - 10, RAMPS.bone.highlight, 1);
      }
    }
    if (isAtk && phase >= 0.35 && phase < 0.72) {
      sub.drawLine(hx - 5, hy - 4, hx - 8, hy + 1, '#FFFFFF', 1);
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 23, 5, 40, frame);
  return finalizeEraCreatureAction(buf, frame, total, 24, 28, action);
}

// 6. Giant Glyptodon (38×26, Tier I)
function renderGlyptodon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const curl = isAtk && phase >= 0.25 && phase < 0.65 ? -3 : 0;

  const buf = new PixelBuffer(38, 26);
  const cx = 18 + curl;
  const cy = 15 + bounceY + (mode === 'swim' ? 2 : 0);

  // Armored club tail
  drawShadedLimb(buf, cx + 7, cy + 2, cx + 14, cy + 3, 1.7, RAMPS.bone);
  if (appLevel === 2) {
    buf.setPixel(cx + 15, cy + 2, RAMPS.bone.highlight);
    buf.setPixel(cx + 15, cy + 4, RAMPS.bone.highlight);
  }

  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 4, cy + 4, cx - 4 - legSwing, 23, 1.6, FUR_BEAR);
    drawShadedLimb(buf, cx + 5, cy + 4, cx + 5 + legSwing, 23, 1.6, FUR_BEAR);
  }

  // Dome carapace with tessellated bone scute grid & K1/K2 sigil
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 9.2, 6.2, (nx, ny, px, py) => {
      const scute = (px + (Math.floor(py / 2) % 2) * 2) % 4 === 0 || py % 3 === 0;
      const base = pickTopLeftTone(nx, ny, RAMPS.bone);
      return scute && ny < 0.6 ? RAMPS.bone.shadow : base;
    });
    sub.fillEllipse(cx - 1, cy - 2, 4.2, 2.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.setPixel(cx - 1, cy - 2, RAMPS.cyanMask.highlight);
    if (appLevel >= 1) {
      sub.setPixel(cx - 6, cy - 3, RAMPS.bone.highlight);
      sub.setPixel(cx + 5, cy - 3, RAMPS.bone.highlight);
    }
  });

  // Armored head cap
  buf.layer((sub) => {
    const hx = cx - 9;
    const hy = cy + 2;
    sub.fillEllipse(hx, hy, 3.0, 2.4, (nx, ny) => pickTopLeftTone(nx, ny, FUR_BEAR));
    sub.fillEllipse(hx, hy - 1, 2.4, 1.3, RAMPS.bone.mid);
    sub.setPixel(hx - 1, hy, '#583A2E');
  });

  if (isAtk && phase >= 0.35 && phase < 0.7) {
    buf.drawLine(cx - 13, cy - 1, cx - 15, cy + 4, '#FFFFFF', 1);
  }
  if (mode === 'swim') clipToSwimUpperBody(buf, 16, 4, 34, frame);
  return finalizeEraCreatureAction(buf, frame, total, 19, 19, action);
}

export const ERA_MEGAFAUNA_MODELS: PixelModelDef[] = [
  {
    id: 'mega-mammoth',
    name: 'Шерстистый Мамонт',
    subtitle: 'Могучий гигант ледниковья (64×52)',
    kind: 'unit',
    tier: 'III',
    era: 'ice-age',
    faction: 'Бастион Мороза',
    width: 64,
    height: 52,
    frameCount: 12,
    defaultFps: 8,
    attackName: 'Удар бивнями и хоботом',
    unitMeta: {
      coreSize: '54×44 гигант',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 30,
      supportsGenes: true,
    },
    layersSpec: ['1. Косматый купол шерсти, ледниковый подвид (тундра/альбинос) и попона K1/K2', '2. Подвижный хобот и изогнутые бивни (гены)'],
    description: 'Исполинский мамонт кайнозоя и ледниковья (масштаб гиганта; при генах тундры/альбиноса — заснеженный Ледниковый подвид): косматая шерсть, перекрашиваемая попона державы и удар хоботом и бивнями.',
    renderFrame: renderMammoth,
    getAnchors: () => ({ head: { x: 15, y: 12, w: 12, h: 12 }, item: { x: 8, y: 22, w: 8, h: 12 }, pivot: { x: 34, y: 47 } }),
    codeSnippet: `function renderMammoth(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(64, 52); }`,
  },
  {
    id: 'mega-woolly-rhino',
    name: 'Шерстистый Носорог',
    subtitle: 'Тяжёлый таран тундры (44×30)',
    kind: 'unit',
    tier: 'II',
    era: 'ice-age',
    faction: 'Бастион Мороза',
    width: 44,
    height: 30,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Таран плоским рогом',
    unitMeta: {
      coreSize: '34×22 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 20,
      supportsGenes: true,
    },
    layersSpec: ['1. Горбатый шерстистый корпус и сбруя K1/K2', '2. Длинный плоский носовой рог (гены)'],
    description: 'Закалённый морозами носорог с массивным загривком, густым дымчатым мехом и сокрушительным рогом для разгона врагов.',
    renderFrame: renderWoollyRhino,
    getAnchors: () => ({ head: { x: 8, y: 12, w: 9, h: 7 }, item: { x: 2, y: 10, w: 7, h: 7 }, pivot: { x: 23, y: 26 } }),
    codeSnippet: `function renderWoollyRhino(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(44, 30); }`,
  },
  {
    id: 'mega-sabertooth',
    name: 'Саблезубый Смилодон',
    subtitle: 'Клыкастый хищник ледниковья (38×26)',
    kind: 'unit',
    tier: 'II',
    era: 'ice-age',
    faction: 'Орда',
    width: 38,
    height: 26,
    frameCount: 12,
    defaultFps: 12,
    attackName: 'Бросок сабельных клыков',
    unitMeta: {
      coreSize: '28×19 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
      supportsGenes: true,
    },
    layersSpec: ['1. Мощный плечевой пояс и золотистая шкура', '2. Ошейник K1/K2 и длинные клыки (гены)'],
    description: 'Мощный саблезубый тигр: коренастое прыгучее тело, ошейник державы K1/K2 и длинные верхние клыки.',
    renderFrame: renderSabertooth,
    getAnchors: () => ({ head: { x: 5, y: 7, w: 7, h: 6 }, item: { x: 2, y: 10, w: 5, h: 5 }, pivot: { x: 19, y: 23 } }),
    codeSnippet: `function renderSabertooth(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(38, 26); }`,
  },
  {
    id: 'mega-cave-bear',
    name: 'Пещерный Медведь',
    subtitle: 'Могучий зверь ледяных пещер (44×34)',
    kind: 'unit',
    tier: 'III',
    era: 'ice-age',
    faction: 'Бастион Мороза',
    width: 44,
    height: 34,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Сокрушительный удар на дыбах',
    unitMeta: {
      coreSize: '34×26 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 20,
      supportsGenes: true,
    },
    layersSpec: ['1. Массивный бурый силуэт без контура', '2. Переход в стойку на дыбах в атаке и сбруя K1/K2'],
    description: 'Гигантский пещерный медведь: тяжело ступает по земле, а в атаке встаёт на задние лапы и обрушивает когтистую лапу.',
    renderFrame: renderCaveBear,
    getAnchors: () => ({ head: { x: 8, y: 11, w: 8, h: 7 }, item: { x: 4, y: 16, w: 6, h: 6 }, pivot: { x: 22, y: 30 } }),
    codeSnippet: `function renderCaveBear(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(44, 34); }`,
  },
  {
    id: 'mega-giant-deer',
    name: 'Гигантский Олень',
    subtitle: 'Большерогий мегалоцерос (46×38)',
    kind: 'unit',
    tier: 'II',
    era: 'ice-age',
    faction: 'Лесной Круг',
    width: 46,
    height: 38,
    frameCount: 12,
    defaultFps: 11,
    attackName: 'Размах огромных рогов',
    unitMeta: {
      coreSize: '36×30 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 18,
      supportsGenes: true,
    },
    layersSpec: ['1. Стройный корпус, высокая шея и попона K1/K2', '2. Широкие лопатообразные рога (гены)'],
    description: 'Величественный большерогий олень тундростепи с перекрашиваемой попоной и огромными ветвистыми рогами.',
    renderFrame: renderGiantDeer,
    getAnchors: () => ({ head: { x: 8, y: 11, w: 7, h: 5 }, item: { x: 4, y: 3, w: 14, h: 10 }, pivot: { x: 24, y: 34 } }),
    codeSnippet: `function renderGiantDeer(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(46, 38); }`,
  },
  {
    id: 'mega-glyptodon',
    name: 'Гигантский Глиптодон',
    subtitle: 'Панцирный броненосец эпохи льда (38×26)',
    kind: 'unit',
    tier: 'I',
    era: 'ice-age',
    faction: 'Цитадель',
    width: 38,
    height: 26,
    frameCount: 10,
    defaultFps: 10,
    attackName: 'Панцирный толчок',
    unitMeta: {
      coreSize: '28×18 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 18,
      supportsGenes: true,
    },
    layersSpec: ['1. Купол из костяных щитков со знаком K1/K2', '2. Шипастый бронированный хвост (гены)'],
    description: 'Непробиваемый гигантский броненосец ледниковой эпохи с куполом из костных щитков и меткой державы.',
    renderFrame: renderGlyptodon,
    getAnchors: () => ({ head: { x: 5, y: 14, w: 6, h: 5 }, item: { x: 29, y: 15, w: 5, h: 4 }, pivot: { x: 19, y: 23 } }),
    codeSnippet: `function renderGlyptodon(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(38, 26); }`,
  },
];
