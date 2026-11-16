import { PixelBuffer } from '../engine/pixelCanvas';
import { renderModelWithContext } from '../models';
import { PixelModelDef, RenderContextOptions } from '../models/types';

function bufferToOffscreenCanvas(buf: PixelBuffer): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = buf.width;
  canvas.height = buf.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const imgData = new ImageData(new Uint8ClampedArray(buf.toRgbaBytes()), buf.width, buf.height);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function triggerDownload(canvas: HTMLCanvasElement, filename: string): void {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadModelFramePng(
  model: PixelModelDef,
  frameIndex: number,
  scale = 8,
  renderCtx?: RenderContextOptions
): void {
  const buf = renderModelWithContext(model, frameIndex, renderCtx);
  const src = bufferToOffscreenCanvas(buf);
  const out = document.createElement('canvas');
  out.width = buf.width * scale;
  out.height = buf.height * scale;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  const suffix = renderCtx?.kingdomId && renderCtx.kingdomId !== 'original' ? `-${renderCtx.kingdomId}` : '';
  triggerDownload(out, `${model.id}${suffix}-frame${frameIndex + 1}-${scale}x.png`);
}

export function downloadModelSpriteSheetPng(
  model: PixelModelDef,
  scale = 4,
  renderCtx?: RenderContextOptions
): void {
  const cols = model.frameCount;
  const out = document.createElement('canvas');
  out.width = model.width * cols * scale;
  out.height = model.height * scale;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  for (let f = 0; f < cols; f++) {
    const buf = renderModelWithContext(model, f, renderCtx);
    const src = bufferToOffscreenCanvas(buf);
    ctx.drawImage(
      src,
      f * model.width * scale,
      0,
      model.width * scale,
      model.height * scale
    );
  }
  const suffix = renderCtx?.kingdomId && renderCtx.kingdomId !== 'original' ? `-${renderCtx.kingdomId}` : '';
  triggerDownload(out, `${model.id}${suffix}-sheet-${cols}f-${scale}x.png`);
}

export function downloadFullAtlasPng(
  models: PixelModelDef[],
  scale = 4,
  renderCtx?: RenderContextOptions
): void {
  const cols = 6;
  const cellW = 68 * scale;
  const cellH = 68 * scale;
  const rows = Math.ceil(models.length / cols);

  const out = document.createElement('canvas');
  out.width = cols * cellW;
  out.height = rows * cellH;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  models.forEach((m, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const buf = renderModelWithContext(m, 0, renderCtx);
    const src = bufferToOffscreenCanvas(buf);
    const dx = col * cellW + Math.floor((cellW - buf.width * scale) / 2);
    const dy = row * cellH + Math.floor((cellH - buf.height * scale) / 2);
    ctx.drawImage(src, dx, dy, buf.width * scale, buf.height * scale);
  });

  const suffix = renderCtx?.kingdomId && renderCtx.kingdomId !== 'original' ? `-${renderCtx.kingdomId}` : '';
  triggerDownload(out, `kostyanaya-kuznya-atlas${suffix}-${scale}x.png`);
}
