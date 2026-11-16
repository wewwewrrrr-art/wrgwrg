import { useEffect, useMemo, useRef } from 'react';
import { bakeModelVariant, drawBakedSpriteToCanvas } from '../engine/spriteAtlas';
import { UnitAction, UnitMode } from '../engine/unitAssembler';
import { renderModelWithContext } from '../models';
import { BuildingState, CreatureGenes, PixelModelDef, RenderContextOptions, StageBg } from '../models/types';

interface PixelSpriteCanvasProps {
  model: PixelModelDef;
  scale?: number;
  isPlaying?: boolean;
  speedMultiplier?: number;
  manualFrame?: number;
  showGrid?: boolean;
  showAnchors?: boolean;
  kingdomId?: string;
  phenotypeId?: string;
  unitMode?: UnitMode;
  unitAction?: UnitAction;
  showShadow?: boolean;
  stageBg?: StageBg;
  genes?: CreatureGenes;
  buildingState?: BuildingState;
  onFrameChange?: (frame: number) => void;
  className?: string;
}

export function PixelSpriteCanvas({
  model,
  scale = 4,
  isPlaying = true,
  speedMultiplier = 1,
  manualFrame,
  showGrid = false,
  showAnchors = false,
  kingdomId = 'original',
  phenotypeId,
  unitMode = 'walk',
  unitAction = 'normal',
  showShadow = true,
  stageBg = 'dark',
  genes,
  buildingState = 'ready',
  onFrameChange,
  className = '',
}: PixelSpriteCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number>(manualFrame ?? 0);
  const onFrameChangeRef = useRef(onFrameChange);
  onFrameChangeRef.current = onFrameChange;

  const renderCtx = useMemo<RenderContextOptions>(
    () => ({
      kingdomId,
      phenotypeId,
      unitMode,
      unitAction,
      showShadow,
      stageBg,
      genes,
      buildingState,
    }),
    [kingdomId, phenotypeId, unitMode, unitAction, showShadow, stageBg, genes, buildingState]
  );

  // Bake all frames of this variant once into the shared shelf-packed sprite atlas
  const bakedRegions = useMemo(
    () => bakeModelVariant(model, renderCtx, renderModelWithContext),
    [model, renderCtx]
  );

  const drawFrame = (idx: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const safeIdx = ((idx % model.frameCount) + model.frameCount) % model.frameCount;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw straight from packed atlas page via hardware-accelerated drawImage
    const region = drawBakedSpriteToCanvas(
      ctx,
      model,
      safeIdx,
      renderCtx,
      renderModelWithContext,
      0,
      0,
      scale
    );

    // Fallback when running in restricted headless canvas without ImageData backing
    if (!region && bakedRegions[safeIdx]) {
      const buf = renderModelWithContext(model, safeIdx, renderCtx);
      const offscreen = document.createElement('canvas');
      offscreen.width = model.width;
      offscreen.height = model.height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        const imgData = new ImageData(new Uint8ClampedArray(buf.toRgbaBytes()), model.width, model.height);
        offCtx.putImageData(imgData, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      }
    }

    if (showGrid && scale >= 4) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < model.width; x++) {
        const gx = x * scale + 0.5;
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, canvas.height);
      }
      for (let y = 1; y < model.height; y++) {
        const gy = y * scale + 0.5;
        ctx.moveTo(0, gy);
        ctx.lineTo(canvas.width, gy);
      }
      ctx.stroke();
    }

    if (showAnchors && model.getAnchors) {
      const anchors = model.getAnchors(safeIdx, model.frameCount, renderCtx);
      if (anchors) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#F59E0B';
        ctx.strokeRect(
          anchors.head.x * scale + 1,
          anchors.head.y * scale + 1,
          anchors.head.w * scale - 2,
          anchors.head.h * scale - 2
        );
        ctx.strokeStyle = '#38BDF8';
        ctx.strokeRect(
          anchors.item.x * scale + 1,
          anchors.item.y * scale + 1,
          anchors.item.w * scale - 2,
          anchors.item.h * scale - 2
        );
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(
          (anchors.pivot.x + 0.5) * scale,
          (anchors.pivot.y + 0.5) * scale,
          Math.max(3, scale * 0.4),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  };

  useEffect(() => {
    if (manualFrame !== undefined) {
      frameRef.current = manualFrame;
      drawFrame(manualFrame);
    }
  }, [manualFrame, bakedRegions, scale, showGrid, showAnchors]);

  useEffect(() => {
    drawFrame(frameRef.current);
    if (!isPlaying || model.frameCount <= 1) return;

    const intervalMs = 1000 / (model.defaultFps * speedMultiplier);
    let lastTime = performance.now();
    let acc = 0;
    let rafId = 0;

    const tick = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;
      acc += dt;
      if (acc >= intervalMs) {
        const steps = Math.floor(acc / intervalMs);
        acc -= steps * intervalMs;
        frameRef.current = (frameRef.current + steps) % model.frameCount;
        drawFrame(frameRef.current);
        onFrameChangeRef.current?.(frameRef.current);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, speedMultiplier, model, bakedRegions, scale, showGrid, showAnchors]);

  return (
    <canvas
      ref={canvasRef}
      width={model.width * scale}
      height={model.height * scale}
      data-testid={`sprite-canvas-${model.id}`}
      aria-label={`Спрайт: ${model.name}`}
      className={`pixelated-canvas block ${className}`}
    />
  );
}
