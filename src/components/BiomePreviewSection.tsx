import {
  Activity,
  CloudRain,
  Code2,
  Download,
  Eraser,
  Eye,
  Gem,
  Pause,
  Play,
  PlusCircle,
  RotateCcw,
  Swords,
  Tornado,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BiomeSimEntity,
  BiomeWorldState,
  applyEarthquakeAt,
  createBiomeSimState,
  isSimWaterPixel,
  removeBiomeEntityById,
  renderBiomeSimBackdrop,
  spawnBiomeModelAt,
  stepBiomeSim,
  toSteppedEntities,
} from '../engine/biomeSimulation';
import { PixelBuffer } from '../engine/pixelCanvas';
import { buildPixelSandboxCastShadow, toPixelSandboxSprite } from '../engine/pixelSandboxStyle';
import { renderModelWithContext } from '../models';
import {
  BIOMES,
  BIOME_HEIGHT,
  BIOME_WIDTH,
  BiomeDefinition,
  BiomeId,
  TILE_SIZE,
  hitTestBiomeEntities,
  sortEntitiesForPaint,
} from '../models/biomes';
import { PixelModelDef } from '../models/types';
import { downloadBiomeCodeTs } from '../utils/exportBiomeCode';
import { BiomeCodeModal } from './BiomeCodeModal';

interface BiomePreviewSectionProps {
  allModels: PixelModelDef[];
  kingdomId: string;
  isPlaying: boolean;
  onTogglePlaying: () => void;
  speedMultiplier: number;
  showShadow: boolean;
  onInspectModel: (model: PixelModelDef, initialTab?: 'preview' | 'code') => void;
}

type SandboxTool = 'inspect' | 'earthquake' | 'weather' | 'substance' | 'spawn' | 'erase';

const BIOME_SCALE = 2;

const KIND_ROLE_LABEL: Record<PixelModelDef['kind'], string> = {
  aquatic: 'Водный монстр',
  nature: 'Природа',
  substance: 'Вещество',
  weather: 'Погода / VFX',
  animated: 'Механизм',
  static: 'Постройка',
  unit: 'Существо',
};

const WEATHER_PRESET_IDS = [
  'vfx-tornado',
  'vfx-dust-devil',
  'vfx-mega-tornado',
  'vfx-firestorm',
  'weather-thundercloud',
  'weather-rain',
  'weather-blizzard',
  'weather-sandstorm',
  'vfx-water-geyser',
];

const SUBSTANCE_PRESET_IDS = [
  'acid-geyser',
  'molten-basalt-vent',
  'ore-stone-deposit',
  'ore-iron-deposit',
  'ore-silver-deposit',
  'gold-quartz-vein',
  'ore-mythril-deposit',
  'ore-adamantine-deposit',
  'ore-ruby-gem-deposit',
  'crystal-geode',
];

const SPAWN_QUICK_IDS = [
  'tyrannosaurus-rex',
  'distortus-rex',
  'gustave-crocodile',
  'kraken',
  'leviathan',
  'forest-treant',
  'paladin-knight',
  'elder-dragon',
  'citadel-keep',
  'watchtower-t1',
  'ancient-oak',
];

function bufferToOffscreenCanvas(buf: PixelBuffer): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = buf.width;
  off.height = buf.height;
  const octx = off.getContext('2d');
  if (octx) {
    const img = octx.createImageData(buf.width, buf.height);
    img.data.set(buf.toRgbaBytes());
    octx.putImageData(img, 0, 0);
  }
  return off;
}

export function BiomePreviewSection({
  allModels,
  kingdomId,
  isPlaying,
  onTogglePlaying,
  speedMultiplier,
  showShadow,
  onInspectModel,
}: BiomePreviewSectionProps) {
  const [activeBiomeId, setActiveBiomeId] = useState<BiomeId>('forest-citadel');
  const [biomeCombat, setBiomeCombat] = useState<boolean>(false);
  const [showWeather, setShowWeather] = useState<boolean>(true);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);

  // Interactive Sandbox / God-Powers state
  const [activeTool, setActiveTool] = useState<SandboxTool>('inspect');
  const [selectedWeatherId, setSelectedWeatherId] = useState<string>('vfx-tornado');
  const [selectedSubstanceId, setSelectedSubstanceId] = useState<string>('acid-geyser');
  const [selectedSpawnId, setSelectedSpawnId] = useState<string>('distortus-rex');
  const [simVersion, setSimVersion] = useState<number>(0);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backdropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spriteCanvasCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const timeRef = useRef<number>(0);
  const hoveredEntityRef = useRef<string | null>(null);
  const hoveredModelRef = useRef<string | null>(null);
  const activeToolRef = useRef<SandboxTool>('inspect');
  hoveredEntityRef.current = hoveredEntityId;
  hoveredModelRef.current = hoveredModelId;
  activeToolRef.current = activeTool;

  const modelById = useMemo(() => {
    const map = new Map<string, PixelModelDef>();
    for (const m of allModels) {
      map.set(m.id, m);
    }
    return map;
  }, [allModels]);

  const activeBiome: BiomeDefinition = useMemo(
    () => BIOMES.find((b) => b.id === activeBiomeId) ?? BIOMES[0],
    [activeBiomeId]
  );

  const simStateRef = useRef<BiomeWorldState | null>(null);
  if (!simStateRef.current || simStateRef.current.biomeId !== activeBiome.id) {
    simStateRef.current = createBiomeSimState(activeBiome, modelById);
    backdropCanvasRef.current = null;
  }

  const resetBiomeWorld = useCallback(() => {
    simStateRef.current = createBiomeSimState(activeBiome, modelById);
    backdropCanvasRef.current = null;
    setHoveredEntityId(null);
    setHoveredModelId(null);
    setSimVersion((v) => v + 1);
  }, [activeBiome, modelById]);

  const handleSelectBiome = (nextId: BiomeId) => {
    const nextBiome = BIOMES.find((b) => b.id === nextId) ?? BIOMES[0];
    simStateRef.current = createBiomeSimState(nextBiome, modelById);
    backdropCanvasRef.current = null;
    setActiveBiomeId(nextId);
    setHoveredEntityId(null);
    setHoveredModelId(null);
    setSimVersion((v) => v + 1);
  };

  // Trigger an earthquake directly on the center/populated settlement of the biome
  const handleTriggerCenterEarthquake = () => {
    const state = simStateRef.current;
    if (!state) return;
    const offsetX = ((state.quakeCount % 3) - 1) * 58;
    const offsetY = ((state.quakeCount % 2) === 0 ? -1 : 1) * 26;
    applyEarthquakeAt(state, activeBiome, 310 + offsetX, 175 + offsetY);
    setSimVersion((v) => v + 1);
  };

  // Derive live roster & telemetry stats whenever entities change
  const biomeStats = useMemo(() => {
    const state = simStateRef.current;
    const entities = state ? state.entities : [];
    let structures = 0;
    let natureAndSub = 0;
    let creatures = 0;
    let weather = 0;
    const roster: { placementId: string; role: string; model: PixelModelDef; hp: number; maxHp: number }[] = [];
    const seenIds = new Set<string>();

    for (const ent of entities) {
      if (ent.destroyed) continue;
      const m = ent.model;
      if (m.kind === 'static' || m.kind === 'animated') structures++;
      else if (m.kind === 'nature' || m.kind === 'substance') natureAndSub++;
      else if (m.kind === 'unit' || m.kind === 'aquatic') creatures++;
      else if (m.kind === 'weather') weather++;
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        roster.push({
          placementId: ent.id,
          role: ent.placement.role,
          model: m,
          hp: ent.hp,
          maxHp: ent.maxHp,
        });
      }
    }

    return {
      structures,
      natureAndSub,
      creatures,
      weather,
      roster,
      quakeCount: state?.quakeCount ?? 0,
      destroyedStructures: state?.destroyedStructures ?? 0,
      creaturesSlain: state?.creaturesSlain ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBiome, simVersion]);

  const hoveredRosterItem = useMemo(
    () =>
      biomeStats.roster.find(
        (r) => r.placementId === hoveredEntityId || r.model.id === hoveredModelId
      ) ?? null,
    [biomeStats.roster, hoveredEntityId, hoveredModelId]
  );

  // Main 60fps Interactive Simulation + Rendering Loop
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();
    let uiSyncAccum = 0;

    const drawFrame = (now: number) => {
      const dt = Math.min(0.06, (now - lastTs) / 1000);
      lastTs = now;
      const state = simStateRef.current;
      if (!state) return;

      const effectiveDt = isPlaying ? dt * speedMultiplier : 0;
      if (isPlaying) {
        timeRef.current += effectiveDt;
      }
      const simTime = timeRef.current;

      const prevAliveCount = state.entities.length;
      const prevDestroyed = state.destroyedStructures;
      const prevSlain = state.creaturesSlain;

      if (effectiveDt > 0) {
        stepBiomeSim(state, activeBiome, effectiveDt, simTime);
      }

      if (state.backdropDirty || !backdropCanvasRef.current) {
        const buf = renderBiomeSimBackdrop(activeBiome, state);
        backdropCanvasRef.current = bufferToOffscreenCanvas(buf);
      }

      // Sync React HUD roster/counters gently (~4Hz only when counts change)
      uiSyncAccum += dt;
      if (
        uiSyncAccum > 0.25 &&
        (state.entities.length !== prevAliveCount ||
          state.destroyedStructures !== prevDestroyed ||
          state.creaturesSlain !== prevSlain)
      ) {
        uiSyncAccum = 0;
        setSimVersion((v) => v + 1);
      }

      const canvas = canvasRef.current;
      if (!canvas || !backdropCanvasRef.current) {
        rafId = requestAnimationFrame(drawFrame);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Camera shake offset during Earthquakes
      let shakeX = 0;
      let shakeY = 0;
      if (state.shakeTimer > 0) {
        const mag = state.shakeIntensity * (state.shakeTimer / 0.75) * BIOME_SCALE;
        shakeX = Math.round(Math.sin(now * 0.08) * mag);
        shakeY = Math.round(Math.cos(now * 0.11) * mag * 0.7);
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);

      // 1. Crisp 640x360 scaled sandbox terrain + any live earthquake cracks/rubble
      ctx.drawImage(backdropCanvasRef.current, 0, 0, canvas.width, canvas.height);

      // 2. Water ripples / lava embers masked strictly to mutable water tiles
      const pal = activeBiome.palette;
      const speed = pal.isLava ? 4 : 7;
      ctx.fillStyle = pal.isLava ? '#FFD65A77' : `${pal.waveColor}3B`;
      for (let ty = 2; ty < BIOME_HEIGHT / TILE_SIZE - 2; ty += 5) {
        for (let i = 0; i < 5; i++) {
          const jitter = ((i * 197 + ty * 313) ^ (i * ty * 17)) & 255;
          const dir = (ty + i) % 2 === 0 ? 1 : -0.5;
          const rx =
            (((jitter * 5 + Math.floor(simTime * speed * dir)) % BIOME_WIDTH) + BIOME_WIDTH) %
            BIOME_WIDTH;
          const ry = ty * TILE_SIZE + (jitter % 3);
          if (
            isSimWaterPixel(state, rx, ry) &&
            isSimWaterPixel(state, Math.min(BIOME_WIDTH - 1, rx + 5), ry)
          ) {
            ctx.fillRect(rx * BIOME_SCALE, ry * BIOME_SCALE, 3 * BIOME_SCALE, BIOME_SCALE);
          }
        }
      }

      // 3. Sort active entities cleanly by layer & Y
      const entityByPlacementId = new Map<string, BiomeSimEntity>();
      for (const e of state.entities) {
        if (!e.destroyed) entityByPlacementId.set(e.id, e);
      }

      const steppedVisible = toSteppedEntities(
        state.entities.filter((e) => showWeather || e.model.kind !== 'weather')
      );
      const sorted = sortEntitiesForPaint(steppedVisible);

      const spriteCache = spriteCanvasCacheRef.current;
      if (spriteCache.size > 900) {
        spriteCache.clear();
      }

      // 4. Paint entities, directional cast shadows, and subtle damage/HP bars when damaged
      for (let idx = 0; idx < sorted.length; idx++) {
        const stepped = sorted[idx];
        const ent = entityByPlacementId.get(stepped.placement.id);
        if (!ent) continue;
        const { model, placement, facing, drawX, drawY } = stepped;

        const fps = model.defaultFps || 8;
        const frameIdx =
          model.frameCount <= 1
            ? 0
            : (Math.floor(simTime * fps) + idx * 2) % model.frameCount;

        const unitMode = placement.unitMode ?? 'walk';
        let unitAction: 'normal' | 'attack' | 'hit' | 'death' = 'normal';
        if (ent.deadTimer !== null) {
          unitAction = 'death';
        } else if (ent.hitTimer > 0) {
          unitAction = 'hit';
        } else if (biomeCombat && (model.kind === 'unit' || model.kind === 'aquatic')) {
          unitAction = 'attack';
        }

        const wbKey = `wb2|${model.id}|${kingdomId}|${unitMode}|${unitAction}|${placement.layer}|${frameIdx}`;
        let spriteCanvas = spriteCache.get(wbKey);
        let wbBuf: PixelBuffer | null = null;
        if (!spriteCanvas) {
          const rawBuf = renderModelWithContext(model, frameIdx, {
            kingdomId,
            unitMode,
            unitAction,
            showShadow: false,
            stageBg: activeBiome.stageBg,
          });
          wbBuf = toPixelSandboxSprite(rawBuf, {
            isAquatic: placement.layer === 'water' || model.kind === 'aquatic',
            isWeather: model.kind === 'weather',
          });
          spriteCanvas = bufferToOffscreenCanvas(wbBuf);
          spriteCache.set(wbKey, spriteCanvas);
        }

        const dx = drawX * BIOME_SCALE;
        const dy = drawY * BIOME_SCALE;
        const dw = model.width * BIOME_SCALE;
        const dh = model.height * BIOME_SCALE;

        const needsShadow =
          showShadow &&
          model.supportsShadow !== false &&
          placement.layer === 'ground' &&
          model.kind !== 'weather';

        if (needsShadow) {
          const shKey = `wbsh2|${model.id}|${kingdomId}|${unitMode}|${unitAction}|${activeBiome.palette.shadowHex}|${frameIdx}`;
          let shadowCanvas = spriteCache.get(shKey);
          if (!shadowCanvas) {
            if (!wbBuf) {
              const rawBuf = renderModelWithContext(model, frameIdx, {
                kingdomId,
                unitMode,
                unitAction,
                showShadow: false,
                stageBg: activeBiome.stageBg,
              });
              wbBuf = toPixelSandboxSprite(rawBuf, {
                isAquatic: false,
                isWeather: false,
              });
            }
            const sh = buildPixelSandboxCastShadow(wbBuf, activeBiome.palette.shadowHex);
            shadowCanvas = bufferToOffscreenCanvas(sh.buffer);
            spriteCache.set(shKey, shadowCanvas);
          }
          ctx.drawImage(
            shadowCanvas,
            dx,
            dy,
            shadowCanvas.width * BIOME_SCALE,
            shadowCanvas.height * BIOME_SCALE
          );
        }

        if (facing === 1) {
          ctx.save();
          ctx.translate(dx + dw, dy);
          ctx.scale(-1, 1);
          ctx.drawImage(spriteCanvas, 0, 0, dw, dh);
          ctx.restore();
        } else {
          ctx.drawImage(spriteCanvas, dx, dy, dw, dh);
        }

        // Show clean compact health bar ONLY on wounded/damaged entities
        if (ent.hp < ent.maxHp && ent.hp > 0 && model.kind !== 'weather') {
          const ratio = Math.max(0, ent.hp / ent.maxHp);
          const barW = Math.min(44, Math.max(20, Math.round(dw * 0.45)));
          const barX = Math.round(dx + dw / 2 - barW / 2);
          const barY = Math.max(4, dy + 4);
          ctx.fillStyle = '#09090BCC';
          ctx.fillRect(barX - 1, barY - 1, barW + 2, 5);
          ctx.fillStyle = ratio > 0.5 ? '#22C55E' : ratio > 0.25 ? '#F59E0B' : '#EF4444';
          ctx.fillRect(barX, barY, Math.max(2, Math.round(barW * ratio)), 3);
        }

        if (hoveredEntityRef.current === placement.id || hoveredModelRef.current === model.id) {
          ctx.strokeStyle = activeToolRef.current === 'erase' ? '#EF4444' : '#EAB308';
          ctx.lineWidth = 2;
          ctx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);
        }
      }

      // 5. Render seismic rubble/dust, acid droplets & floating damage numbers
      for (const pt of state.particles) {
        const px = Math.round(pt.x) * BIOME_SCALE;
        const py = Math.round(pt.y) * BIOME_SCALE;
        const sz = pt.size * BIOME_SCALE;
        ctx.fillStyle = pt.color;
        ctx.fillRect(px, py, sz, sz);
      }

      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      for (const pop of state.popups) {
        const alpha = Math.max(0, Math.min(1, pop.life / pop.maxLife));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#0B0B0D';
        ctx.fillText(pop.text, pop.x * BIOME_SCALE + 1, pop.y * BIOME_SCALE + 1);
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, pop.x * BIOME_SCALE, pop.y * BIOME_SCALE);
      }
      ctx.globalAlpha = 1;

      ctx.restore();

      if (isPlaying) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    activeBiome,
    biomeCombat,
    isPlaying,
    kingdomId,
    showShadow,
    showWeather,
    speedMultiplier,
    // Keep simVersion only when paused so manual spawns/quakes redraw immediately without interrupting 60fps play
    isPlaying ? 0 : simVersion,
    isPlaying ? '' : hoveredEntityId,
    isPlaying ? '' : hoveredModelId,
    isPlaying ? '' : activeTool,
  ]);

  const toLogicalCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const bx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * BIOME_WIDTH;
    const by = ((e.clientY - rect.top) / Math.max(1, rect.height)) * BIOME_HEIGHT;
    return { bx, by };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const state = simStateRef.current;
    if (!state) return;
    const { bx, by } = toLogicalCoords(e);
    const stepped = toSteppedEntities(state.entities);
    const hit = hitTestBiomeEntities(stepped, bx, by);
    setHoveredEntityId(hit ? hit.placement.id : null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const state = simStateRef.current;
    if (!state) return;
    const { bx, by } = toLogicalCoords(e);

    if (activeTool === 'earthquake') {
      applyEarthquakeAt(state, activeBiome, bx, by);
      setSimVersion((v) => v + 1);
      return;
    }

    if (activeTool === 'weather') {
      const m = modelById.get(selectedWeatherId);
      if (m) {
        if (!showWeather) setShowWeather(true);
        spawnBiomeModelAt(state, m, bx, by);
        setSimVersion((v) => v + 1);
      }
      return;
    }

    if (activeTool === 'substance') {
      const m = modelById.get(selectedSubstanceId);
      if (m) {
        spawnBiomeModelAt(state, m, bx, by);
        setSimVersion((v) => v + 1);
      }
      return;
    }

    if (activeTool === 'spawn') {
      const m = modelById.get(selectedSpawnId);
      if (m) {
        spawnBiomeModelAt(state, m, bx, by);
        setSimVersion((v) => v + 1);
      }
      return;
    }

    if (activeTool === 'erase') {
      // Allow deleting weather too if clicked near center
      const stepped = toSteppedEntities(state.entities);
      let target = hitTestBiomeEntities(stepped, bx, by);
      if (!target) {
        // Fallback hit test including weather
        const pad = 6;
        for (let i = stepped.length - 1; i >= 0; i--) {
          const ent = stepped[i];
          if (
            bx >= ent.drawX - pad &&
            bx <= ent.drawX + ent.model.width + pad &&
            by >= ent.drawY - pad &&
            by <= ent.drawY + ent.model.height + pad
          ) {
            target = ent;
            break;
          }
        }
      }
      if (target && removeBiomeEntityById(state, target.placement.id)) {
        setHoveredEntityId(null);
        setSimVersion((v) => v + 1);
      }
      return;
    }

    // Default 'inspect' mode
    const stepped = toSteppedEntities(state.entities);
    const hit = hitTestBiomeEntities(stepped, bx, by);
    if (hit) {
      onInspectModel(hit.model, 'preview');
    }
  };

  const weatherPresets = useMemo(
    () => WEATHER_PRESET_IDS.map((id) => modelById.get(id)).filter((m): m is PixelModelDef => Boolean(m)),
    [modelById]
  );

  const substancePresets = useMemo(
    () => SUBSTANCE_PRESET_IDS.map((id) => modelById.get(id)).filter((m): m is PixelModelDef => Boolean(m)),
    [modelById]
  );

  const spawnQuickPresets = useMemo(
    () => SPAWN_QUICK_IDS.map((id) => modelById.get(id)).filter((m): m is PixelModelDef => Boolean(m)),
    [modelById]
  );

  const spawnableCatalogModels = useMemo(
    () =>
      allModels.filter(
        (m) => m.kind === 'unit' || m.kind === 'aquatic' || m.kind === 'static' || m.kind === 'animated' || m.kind === 'nature'
      ),
    [allModels]
  );

  const toolHint =
    activeTool === 'earthquake'
      ? 'Нажмите в любую точку острова, чтобы вызвать землетрясение: разлом вспарывает почву, рушит постройки и бьёт существ'
      : activeTool === 'weather'
        ? `Нажмите на карту, чтобы запустить эффект: ${modelById.get(selectedWeatherId)?.name ?? ''}`
        : activeTool === 'substance'
          ? `Нажмите на землю, чтобы разместить: ${modelById.get(selectedSubstanceId)?.name ?? ''}`
          : activeTool === 'spawn'
            ? `Нажмите на карту, чтобы добавить модель: ${modelById.get(selectedSpawnId)?.name ?? ''}`
            : activeTool === 'erase'
              ? 'Нажмите на любой объект или смерч на карте, чтобы удалить его'
              : 'Наведите на любое существо, постройку или монстра в биоме и нажмите, чтобы разобрать слои и код';

  return (
    <section
      id="biome"
      data-testid="biome-preview-section"
      data-biome={activeBiome.id}
      data-combat={biomeCombat ? 'attack' : 'normal'}
      data-tool={activeTool}
      className="border-b border-[#26262B] bg-[#0E0E12]"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        <div className="flex flex-col gap-6 border-b border-[#26262B] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-wide text-[#EAB308]">
              2D-песочница биома (вид сверху) · Живая симуляция стихий, руд, существ и разломов
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#F4F2ED]">
              2D-диорама биома: {activeBiome.name}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
              {activeBiome.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-testid="biome-combat-toggle"
              aria-pressed={biomeCombat}
              onClick={() => setBiomeCombat((c) => !c)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                biomeCombat
                  ? 'border-[#38BDF8] bg-[#38BDF8]/15 text-[#38BDF8]'
                  : 'border-[#2E2E34] bg-[#141417] text-[#F4F2ED] hover:border-[#4A4A54]'
              }`}
            >
              <Swords className="h-3.5 w-3.5" />
              <span>{biomeCombat ? 'Боевая тревога: Вкл' : 'Режим: Патруль'}</span>
            </button>

            <button
              type="button"
              data-testid="biome-weather-toggle"
              aria-pressed={showWeather}
              onClick={() => setShowWeather((w) => !w)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                showWeather
                  ? 'border-[#EAB308] bg-[#EAB308]/15 text-[#EAB308]'
                  : 'border-[#2E2E34] bg-[#141417] text-[#A1A1AA] hover:border-[#4A4A54] hover:text-[#F4F2ED]'
              }`}
            >
              <CloudRain className="h-3.5 w-3.5" />
              <span>{showWeather ? 'Погода: Вкл' : 'Погода: Выкл'}</span>
            </button>

            <button
              type="button"
              onClick={onTogglePlaying}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E34] bg-[#141417] px-3.5 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#4A4A54] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{isPlaying ? 'Пауза' : 'Пуск'}</span>
            </button>

            <button
              type="button"
              data-testid="btn-reset-biome"
              onClick={resetBiomeWorld}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E34] bg-[#141417] px-3.5 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308]/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[#EAB308]" />
              <span>Сброс карты</span>
            </button>

            <button
              type="button"
              data-testid="biome-code-btn"
              aria-label={`Открыть код биома ${activeBiome.name}`}
              onClick={() => setIsCodeModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E34] bg-[#141417] px-3.5 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
            >
              <Code2 className="h-3.5 w-3.5 text-[#EAB308]" />
              <span>Код биома</span>
            </button>

            <button
              type="button"
              data-testid="biome-download-ts-btn"
              aria-label={`Скачать код биома ${activeBiome.name} (.ts)`}
              onClick={() => downloadBiomeCodeTs(activeBiome, simStateRef.current)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#EAB308] px-3.5 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Скачать код (.ts)</span>
            </button>
          </div>
        </div>

        {/* Biome Selector Tabs + Live Simulation Stats */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div
            role="tablist"
            aria-label="Выбор биома"
            className="flex flex-wrap items-center gap-2"
          >
            {BIOMES.map((biome) => {
              const active = biome.id === activeBiome.id;
              return (
                <button
                  key={biome.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`biome-tab-${biome.id}`}
                  onClick={() => handleSelectBiome(biome.id)}
                  className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                    active
                      ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                      : 'border border-[#26262B] bg-[#131316] text-[#A1A1AA] hover:border-[#3A3A42] hover:text-[#F4F2ED]'
                  }`}
                >
                  {biome.name}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-[#8E8E98] font-mono tabular-nums" data-testid="biome-stats-line">
            Постройки: {biomeStats.structures} · Существа: {biomeStats.creatures} · Разрушено: {biomeStats.destroyedStructures} · Разломов: {biomeStats.quakeCount}
          </p>
        </div>

        {/* God-Tools / Sandbox Action Bar */}
        <div className="mt-4 rounded-xl border border-[#26262D] bg-[#121216] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Инструменты песочницы биома">
              <button
                type="button"
                data-testid="tool-inspect"
                aria-pressed={activeTool === 'inspect'}
                onClick={() => setActiveTool('inspect')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeTool === 'inspect'
                    ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                    : 'border border-[#26262D] bg-[#17171C] text-[#D4D2CD] hover:border-[#4A4A54]'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Инспектор</span>
              </button>

              <button
                type="button"
                data-testid="tool-earthquake"
                aria-pressed={activeTool === 'earthquake'}
                onClick={() => setActiveTool('earthquake')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeTool === 'earthquake'
                    ? 'bg-[#F97316] font-semibold text-[#0B0B0D]'
                    : 'border border-[#26262D] bg-[#17171C] text-[#D4D2CD] hover:border-[#F97316]/60'
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                <span>Землетрясение</span>
              </button>

              <button
                type="button"
                data-testid="tool-weather"
                aria-pressed={activeTool === 'weather'}
                onClick={() => setActiveTool('weather')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeTool === 'weather'
                    ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                    : 'border border-[#26262D] bg-[#17171C] text-[#D4D2CD] hover:border-[#38BDF8]/60'
                }`}
              >
                <Tornado className="h-3.5 w-3.5" />
                <span>Вихри и стихии</span>
              </button>

              <button
                type="button"
                data-testid="tool-substance"
                aria-pressed={activeTool === 'substance'}
                onClick={() => setActiveTool('substance')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeTool === 'substance'
                    ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                    : 'border border-[#26262D] bg-[#17171C] text-[#D4D2CD] hover:border-[#34D399]/60'
                }`}
              >
                <Gem className="h-3.5 w-3.5" />
                <span>Руды и гейзеры</span>
              </button>

              <button
                type="button"
                data-testid="tool-spawn"
                aria-pressed={activeTool === 'spawn'}
                onClick={() => setActiveTool('spawn')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeTool === 'spawn'
                    ? 'bg-[#A78BFA] font-semibold text-[#0B0B0D]'
                    : 'border border-[#26262D] bg-[#17171C] text-[#D4D2CD] hover:border-[#A78BFA]/60'
                }`}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                <span>Существа и объекты</span>
              </button>

              <button
                type="button"
                data-testid="tool-erase"
                aria-pressed={activeTool === 'erase'}
                onClick={() => setActiveTool('erase')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeTool === 'erase'
                    ? 'bg-[#EF4444] font-semibold text-[#FFFFFF]'
                    : 'border border-[#26262D] bg-[#17171C] text-[#D4D2CD] hover:border-[#EF4444]/60'
                }`}
              >
                <Eraser className="h-3.5 w-3.5" />
                <span>Удалить</span>
              </button>
            </div>

            <button
              type="button"
              data-testid="btn-trigger-quake"
              onClick={handleTriggerCenterEarthquake}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#F97316]/50 bg-[#F97316]/15 px-3 py-1.5 text-xs font-medium text-[#FDBA74] hover:bg-[#F97316]/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Сейсмический удар сейчас</span>
            </button>
          </div>

          {/* Sub-palette for the selected sandbox tool */}
          {activeTool === 'weather' && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#202026] pt-2.5">
              {weatherPresets.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedWeatherId(m.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                    selectedWeatherId === m.id
                      ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                      : 'border border-[#26262D] bg-[#17171C] text-[#C4C2BD] hover:border-[#4A4A54]'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}

          {activeTool === 'substance' && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#202026] pt-2.5">
              {substancePresets.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedSubstanceId(m.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                    selectedSubstanceId === m.id
                      ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                      : 'border border-[#26262D] bg-[#17171C] text-[#C4C2BD] hover:border-[#4A4A54]'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}

          {activeTool === 'spawn' && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#202026] pt-2.5">
              {spawnQuickPresets.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedSpawnId(m.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                    selectedSpawnId === m.id
                      ? 'bg-[#A78BFA] font-semibold text-[#0B0B0D]'
                      : 'border border-[#26262D] bg-[#17171C] text-[#C4C2BD] hover:border-[#4A4A54]'
                  }`}
                >
                  {m.name}
                </button>
              ))}
              <label className="ml-auto inline-flex items-center gap-2 text-[11px] text-[#8E8E98]">
                <span>Любая модель:</span>
                <select
                  aria-label="Выбрать любую модель для добавления на карту"
                  value={selectedSpawnId}
                  onChange={(e) => setSelectedSpawnId(e.target.value)}
                  className="rounded-md border border-[#2C2C34] bg-[#17171C] px-2 py-1 text-[11px] text-[#F4F2ED] focus:outline-none focus:border-[#A78BFA]"
                >
                  {spawnableCatalogModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({KIND_ROLE_LABEL[m.kind]})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* Interactive Pixel Diorama Stage */}
        <div className="mt-4 relative overflow-hidden rounded-2xl border border-[#2A2A32] bg-[#121216] shadow-2xl">
          <canvas
            ref={canvasRef}
            data-testid="biome-canvas"
            width={BIOME_WIDTH * BIOME_SCALE}
            height={BIOME_HEIGHT * BIOME_SCALE}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoveredEntityId(null)}
            onClick={handleCanvasClick}
            className={`block w-full aspect-[640/360] pixelated-canvas ${
              activeTool === 'inspect' && hoveredEntityId ? 'cursor-pointer' : 'cursor-crosshair'
            }`}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#24242B] bg-[#111115]/95 px-5 py-3 text-xs">
            <div className="flex items-center gap-2 text-[#D4D2CD]">
              <Eye className="h-3.5 w-3.5 text-[#EAB308] shrink-0" />
              {activeTool === 'inspect' && hoveredRosterItem ? (
                <span>
                  <strong className="font-semibold text-[#F4F2ED]">
                    {hoveredRosterItem.model.name}
                  </strong>{' '}
                  <span className="text-[#8E8E98]">
                    · {hoveredRosterItem.role}
                    {hoveredRosterItem.maxHp < 9999 ? ` · HP ${hoveredRosterItem.hp}/${hoveredRosterItem.maxHp}` : ''}
                    {hoveredRosterItem.model.attackName
                      ? ` · Атака: ${hoveredRosterItem.model.attackName}`
                      : ''}
                    {' · Нажмите на объект для открытия инспектора'}
                  </span>
                </span>
              ) : (
                <span className="text-[#A1A1AA]">{toolHint}</span>
              )}
            </div>
            <span className="font-mono text-[11px] text-[#8E8E98] tabular-nums">
              {BIOME_WIDTH}×{BIOME_HEIGHT} сетка · {activeBiome.subtitle}
            </span>
          </div>
        </div>

        {/* Biome Entity Roster Strip */}
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between text-xs text-[#8E8E98]">
            <span>Объекты на карте ({biomeStats.roster.length})</span>
            <span>Нажмите на карточку для открытия инспектора</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {biomeStats.roster.map((item) => {
              const isHighlighted =
                hoveredEntityId === item.placementId || hoveredModelId === item.model.id;
              return (
                <button
                  key={item.placementId}
                  type="button"
                  onMouseEnter={() => {
                    setHoveredEntityId(item.placementId);
                    setHoveredModelId(item.model.id);
                  }}
                  onMouseLeave={() => {
                    setHoveredEntityId(null);
                    setHoveredModelId(null);
                  }}
                  onClick={() => onInspectModel(item.model, 'preview')}
                  className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                    isHighlighted
                      ? 'border-[#EAB308] bg-[#EAB308]/10'
                      : 'border-[#24242B] bg-[#141418] hover:border-[#3E3E48]'
                  }`}
                >
                  <span className="w-full truncate text-xs font-medium text-[#F4F2ED]">
                    {item.model.name}
                  </span>
                  <span className="mt-0.5 w-full truncate text-[11px] text-[#8E8E98]">
                    {item.role} · {KIND_ROLE_LABEL[item.model.kind]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <BiomeCodeModal
        biome={isCodeModalOpen ? activeBiome : null}
        simState={simStateRef.current}
        onClose={() => setIsCodeModalOpen(false)}
      />
    </section>
  );
}
