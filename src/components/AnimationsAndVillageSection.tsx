import {
  Flame,
  Gauge,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Swords,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_MODELS } from '../models';
import type { BuildingState, GeneCoat, GenePattern, PixelModelDef } from '../models/types';
import {
  BUILDING_ANIMATION_SPEC,
  renderAnimatedBuildingFrame,
} from '../engine/buildingAnimations';
import {
  CREATURE_ANIMATION_ACTIONS,
  CREATURE_ANIMATION_SPECS,
  type CreatureAnimationAction,
  renderAnimatedCreatureFrame,
} from '../engine/creatureAnimations';
import {
  PIXEL_VFX_IDS,
  PIXEL_VFX_SPECS,
  renderVfxFrame,
} from '../engine/pixelVfx';
import { PixelBuffer } from '../engine/pixelCanvas';
import {
  ACTIVE_UNIT_RACES,
  ALL_UNIT_RACE_LABELS,
  type ActiveUnitRace,
  MEDIEVAL_ROLE_LABELS,
  type MedievalHumanRole,
  type ProceduralAnchors,
  UNIT_ANIMATION_ACTIONS,
  UNIT_CARRY_ITEMS,
  type UnitAnimationAction,
  type UnitCarryItem,
  generateProceduralUnit,
  getRaceActionSpec,
} from '../engine/proceduralHuman';
import { FLAGSHIP_SIX_KINGDOMS } from '../engine/proceduralBuildingsAndAnimals';
import { ALL_RACE_BUILDINGS, MEDIEVAL_TOWN_HALL } from '../engine/proceduralRaceBuildings';
import {
  type AnimatedUnitsBenchmarkResult,
  VILLAGE_WORLD_H,
  VILLAGE_WORLD_W,
  benchmarkAnimatedUnits,
  createVillageSimulation,
  getDefaultEraForRace,
  stepVillageSimulation,
} from '../engine/villageSimulation';

function paintPixelBuffer(
  ctx: CanvasRenderingContext2D,
  buf: PixelBuffer,
  dx: number,
  dy: number,
  scale = 1,
  flipH = false
): void {
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const c = buf.getPixel(x, y);
      if (!c) continue;
      const rx = flipH ? buf.width - 1 - x : x;
      ctx.fillStyle = c;
      ctx.fillRect((dx + rx) * scale, (dy + y) * scale, scale, scale);
    }
  }
}

function PixelCanvasBox({
  buf,
  scale,
  anchors,
  showAnchors = false,
  ariaLabel,
  testId,
}: {
  buf: PixelBuffer;
  scale: number;
  anchors?: ProceduralAnchors;
  showAnchors?: boolean;
  ariaLabel?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = buf.width * scale;
    const h = buf.height * scale;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    paintPixelBuffer(ctx, buf, 0, 0, scale, false);

    if (showAnchors && anchors && scale >= 6) {
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, (anchors.feetY + 1) * scale - 1);
      ctx.lineTo(w, (anchors.feetY + 1) * scale - 1);
      ctx.stroke();

      ctx.strokeStyle = '#38BDF8';
      ctx.strokeRect(
        anchors.hand.leftX * scale + 1,
        anchors.hand.leftY * scale + 1,
        scale - 2,
        scale - 2
      );
      ctx.strokeStyle = '#F472B6';
      ctx.strokeRect(
        anchors.hand.rightX * scale + 1,
        anchors.hand.rightY * scale + 1,
        scale - 2,
        scale - 2
      );
    }
  }, [buf, scale, anchors, showAnchors]);

  return (
    <canvas
      ref={ref}
      aria-label={ariaLabel}
      data-testid={testId}
      style={{ imageRendering: 'pixelated' }}
      className="block"
    />
  );
}

const CREATURE_SHOWCASE_IDS = [
  'dire-wolf',
  'steppe-eagle',
  'wild-boar',
  'megalodon',
  'dino-pteranodon',
  'tyrannosaurus-rex',
  'mega-mammoth',
  'elder-dragon',
] as const;

const BUILDING_ANIM_IDS = [
  'citadel-keep',
  'ironclad-armory',
  'medieval-town-hall',
  'marsh-stilt-hut',
  'stonekin-monolith',
  'antler-living-grove',
] as const;

const ROLE_LIST = Object.keys(MEDIEVAL_ROLE_LABELS) as MedievalHumanRole[];
const GAIT_RACES: readonly { readonly race: ActiveUnitRace; readonly note: string }[] = [
  { race: 'marshfolk', note: 'переваливается' },
  { race: 'antlerfolk', note: 'медленный шаг (1.55×)' },
  { race: 'raptor-kin', note: 'бег в наклоне (0.78×)' },
  { race: 'hive-mind', note: 'пульсирует без ролей' },
];

export function AnimationsAndVillageSection() {
  const [activeTab, setActiveTab] = useState<'gallery' | 'village'>('gallery');

  // Shared controls
  const [unitRace, setUnitRace] = useState<ActiveUnitRace>('human');
  const [unitRole, setUnitRole] = useState<MedievalHumanRole>('warrior');
  const [unitAction, setUnitAction] = useState<UnitAnimationAction>('walk');
  const [unitCarry, setUnitCarry] = useState<UnitCarryItem>('none');
  const [kingdomIdx, setKingdomIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speedMult, setSpeedMult] = useState<1 | 4>(1);
  const [stepMode, setStepMode] = useState<boolean>(false);
  const [manualFrame, setManualFrame] = useState<number>(0);
  const [showAnchors, setShowAnchors] = useState<boolean>(true);

  // Creature gallery state
  const [creatureId, setCreatureId] = useState<string>('steppe-eagle');
  const [creatureAction, setCreatureAction] = useState<CreatureAnimationAction>('walk');
  const [creatureCoat, setCreatureCoat] = useState<GeneCoat>('natural');
  const [creaturePattern, setCreaturePattern] = useState<GenePattern>('solid');

  // Building animation gallery state
  const [buildingId, setBuildingId] = useState<string>('citadel-keep');
  const [buildingState, setBuildingState] = useState<BuildingState>('ready');
  const [buildingBurning, setBuildingBurning] = useState<boolean>(false);

  // Village scene state
  const [villageRace, setVillageRace] = useState<ActiveUnitRace>('human');
  const [villageBurning, setVillageBurning] = useState<boolean>(false);
  const [benchmark, setBenchmark] = useState<AnimatedUnitsBenchmarkResult | null>(null);
  const [villageStats, setVillageStats] = useState({
    unitCount: 20,
    vfxCount: 0,
    simTimeSec: 0,
  });

  // Gallery playback timer respecting race frameDurationsMs & 1x/4x speed
  const [autoFrameTick, setAutoFrameTick] = useState<number>(0);
  const unitSpec = useMemo(() => getRaceActionSpec(unitRace, unitAction), [unitRace, unitAction]);
  const activeFrameIdx = stepMode
    ? manualFrame % unitSpec.frameCount
    : autoFrameTick % unitSpec.frameCount;

  useEffect(() => {
    if (activeTab !== 'gallery' || !isPlaying || stepMode) return;
    const ms = Math.max(
      25,
      Math.round((unitSpec.frameDurationsMs[activeFrameIdx] ?? 160) / speedMult)
    );
    const id = window.setTimeout(() => {
      setAutoFrameTick((t) => (t + 1) % 1200);
    }, ms);
    return () => window.clearTimeout(id);
  }, [activeTab, isPlaying, stepMode, speedMult, activeFrameIdx, unitSpec]);

  const currentEra = getDefaultEraForRace(unitRace);
  const currentUnit = useMemo(
    () =>
      generateProceduralUnit({
        seed: 4242,
        era: currentEra,
        race: unitRace,
        role: unitRole,
        action: unitAction,
        carry: unitCarry,
        kingdomId: kingdomIdx,
        frameIndex: activeFrameIdx,
      }),
    [currentEra, unitRace, unitRole, unitAction, unitCarry, kingdomIdx, activeFrameIdx]
  );

  // Strip 0..frameCount-1 frames for current unit
  const unitStripFrames = useMemo(
    () =>
      Array.from({ length: unitSpec.frameCount }, (_, f) =>
        generateProceduralUnit({
          seed: 4242,
          era: currentEra,
          race: unitRace,
          role: unitRole,
          action: unitAction,
          carry: unitCarry,
          kingdomId: kingdomIdx,
          frameIndex: f,
        })
      ),
    [unitSpec.frameCount, currentEra, unitRace, unitRole, unitAction, unitCarry, kingdomIdx]
  );

  // Creature lookup & render
  const modelById = useMemo(
    () =>
      new Map<string, PixelModelDef>([
        ...ALL_MODELS.map((m) => [m.id, m] as const),
        ...ALL_RACE_BUILDINGS.map((m) => [m.id, m] as const),
        [MEDIEVAL_TOWN_HALL.id, MEDIEVAL_TOWN_HALL],
      ]),
    []
  );
  const creatureModel = modelById.get(creatureId) ?? ALL_MODELS[0];
  const creatureSpec = CREATURE_ANIMATION_SPECS[creatureAction];
  const creatureFrameIdx = stepMode
    ? manualFrame % creatureSpec.frameCount
    : autoFrameTick % creatureSpec.frameCount;

  const currentCreature = useMemo(
    () =>
      renderAnimatedCreatureFrame(
        creatureModel,
        creatureAction,
        creatureFrameIdx,
        { coat: creatureCoat, pattern: creaturePattern, size: 'standard', appendages: 'standard', biomeTint: 'none' },
        kingdomIdx,
        { stageBg: 'dark', showShadow: true }
      ),
    [creatureModel, creatureAction, creatureFrameIdx, creatureCoat, creaturePattern, kingdomIdx]
  );

  // Building animated frame
  const buildingModel = modelById.get(buildingId) ?? MEDIEVAL_TOWN_HALL;
  const buildingFrameIdx = stepMode ? manualFrame % 4 : autoFrameTick % 4;
  const currentBuilding = useMemo(
    () =>
      renderAnimatedBuildingFrame(
        buildingModel,
        kingdomIdx,
        buildingState,
        buildingFrameIdx,
        { burning: buildingBurning, stageBg: 'dark', showShadow: true }
      ),
    [buildingModel, kingdomIdx, buildingState, buildingFrameIdx, buildingBurning]
  );

  // 5 Pixel VFX frames
  const vfxFrameIdx = stepMode ? manualFrame % 4 : autoFrameTick % 4;
  const vfxEntries = useMemo(
    () =>
      PIXEL_VFX_IDS.map((effectId) => {
        const buf = renderVfxFrame(effectId, vfxFrameIdx, {
          k1Hex: FLAGSHIP_SIX_KINGDOMS[kingdomIdx]?.primaryHex,
        });
        const colors = new Set<string>();
        let semi = 0;
        for (let y = 0; y < buf.height; y++) {
          for (let x = 0; x < buf.width; x++) {
            const px = buf.getPixel(x, y);
            if (!px) continue;
            colors.add(px);
            if (px.length === 9) {
              const a = parseInt(px.slice(7, 9), 16);
              if (a > 0 && a < 255) semi++;
            }
          }
        }
        return {
          spec: PIXEL_VFX_SPECS[effectId],
          buf,
          uniqueColors: colors.size,
          semi,
        };
      }),
    [vfxFrameIdx, kingdomIdx]
  );

  // Live Village Simulation Canvas & sprite buffer cache
  const villageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef(createVillageSimulation(villageRace, kingdomIdx, villageBurning));
  const spriteCacheRef = useRef<Map<string, PixelBuffer>>(new Map());

  useEffect(() => {
    simRef.current = createVillageSimulation(villageRace, kingdomIdx, villageBurning);
    spriteCacheRef.current.clear();
    setVillageStats({
      unitCount: simRef.current.units.length,
      vfxCount: simRef.current.vfx.length,
      simTimeSec: 0,
    });
  }, [villageRace, kingdomIdx]);

  useEffect(() => {
    simRef.current.burningBuilding = villageBurning;
  }, [villageBurning]);

  const renderVillageToCanvas = () => {
    const canvas = villageCanvasRef.current;
    if (!canvas) return;
    const cache = spriteCacheRef.current;
    const getCached = (key: string, build: () => PixelBuffer): PixelBuffer => {
      let b = cache.get(key);
      if (!b) {
        if (cache.size > 600) cache.clear();
        b = build();
        cache.set(key, b);
      }
      return b;
    };
    const scale = 3;
    const w = VILLAGE_WORLD_W * scale;
    const h = VILLAGE_WORLD_H * scale;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const sim = simRef.current;
    // Sky & crisp layered meadow terrain
    ctx.fillStyle = sim.era === 'ice-age' ? '#2A394A' : sim.era === 'dinosaurs' ? '#364A32' : '#243C29';
    ctx.fillRect(0, 0, w, h);

    // Horizon / sky band
    ctx.fillStyle = sim.era === 'ice-age' ? '#3A4D63' : '#1E2C3A';
    ctx.fillRect(0, 0, w, 24 * scale);

    // Dirt village plaza road
    ctx.fillStyle = '#4B3E2F';
    ctx.fillRect(28 * scale, 64 * scale, 184 * scale, 22 * scale);
    ctx.fillStyle = '#5C4C3A';
    ctx.fillRect(36 * scale, 68 * scale, 168 * scale, 12 * scale);

    // Pond on bottom-left for anglers
    ctx.fillStyle = '#144B6E';
    ctx.fillRect(14 * scale, 108 * scale, 36 * scale, 18 * scale);
    ctx.fillStyle = '#2572A1';
    ctx.fillRect(17 * scale, 111 * scale, 28 * scale, 11 * scale);

    // Forest grove on west edge & quarry rocks on north-east
    for (const [tx, ty] of [[18, 66], [24, 86], [16, 94]] as const) {
      ctx.fillStyle = '#5C3A21';
      ctx.fillRect((tx + 2) * scale, (ty + 4) * scale, 2 * scale, 4 * scale);
      ctx.fillStyle = '#2D5A36';
      ctx.fillRect(tx * scale, ty * scale, 6 * scale, 5 * scale);
    }
    for (const [rx, ry] of [[170, 50], [182, 56], [176, 68]] as const) {
      ctx.fillStyle = '#6B7280';
      ctx.fillRect(rx * scale, ry * scale, 7 * scale, 5 * scale);
      ctx.fillStyle = '#9CA3AF';
      ctx.fillRect(rx * scale, ry * scale, 5 * scale, 2 * scale);
    }

    // Buildings (animated chimney smoke, forge fire, waving flags, optional burning building)
    const bAnimFrame = Math.floor(sim.simTimeMs / BUILDING_ANIMATION_SPEC.frameDurationsMs[0]) % 4;
    for (const slot of sim.buildings) {
      const burnFlag = sim.burningBuilding && slot.isBurningCandidate;
      const bKey = `b|${slot.model.id}|${sim.kingdomId}|${burnFlag ? 1 : 0}|${bAnimFrame}`;
      const bBuf = getCached(bKey, () =>
        renderAnimatedBuildingFrame(
          slot.model,
          sim.kingdomId,
          'ready',
          bAnimFrame,
          {
            burning: burnFlag,
            stageBg: 'meadow',
            showShadow: false,
          }
        ).buffer
      );
      paintPixelBuffer(ctx, bBuf, Math.round(slot.x), Math.round(slot.y), scale, false);
    }

    // Roaming creatures
    for (const c of sim.creatures) {
      const cKey = `c|${c.model.id}|${c.action}|${c.frameIndex}|${sim.kingdomId}`;
      const cBuf = getCached(cKey, () =>
        renderAnimatedCreatureFrame(
          c.model,
          c.action,
          c.frameIndex,
          { coat: 'natural', pattern: 'solid', size: 'standard', appendages: 'standard', biomeTint: 'none' },
          sim.kingdomId,
          { stageBg: 'meadow', showShadow: false }
        ).buffer
      );
      paintPixelBuffer(
        ctx,
        cBuf,
        Math.round(c.x - cBuf.width / 2),
        Math.round(c.y - cBuf.height / 2),
        scale,
        c.facing === 1
      );
    }

    // Depth-sorted 20 units
    const sortedUnits = [...sim.units].sort((a, b) => a.y - b.y);
    for (const u of sortedUnits) {
      const uKey = `u|${u.seed}|${u.era}|${u.race}|${u.role}|${u.gender}|${u.age}|${u.action}|${u.carry}|${sim.kingdomId}|${u.frameIndex}`;
      const unitBuf = getCached(uKey, () =>
        generateProceduralUnit({
          seed: u.seed,
          era: u.era,
          race: u.race,
          role: u.role,
          gender: u.gender,
          age: u.age,
          action: u.action,
          carry: u.carry,
          kingdomId: sim.kingdomId,
          frameIndex: u.frameIndex,
        }).buffer
      );
      // Subtle ground contact indicator (100% opaque shadow stripe)
      ctx.fillStyle = '#18241C';
      ctx.fillRect(Math.round(u.x - 3) * scale, Math.round(u.y + 4) * scale, 6 * scale, scale);
      paintPixelBuffer(
        ctx,
        unitBuf,
        Math.round(u.x - 5),
        Math.round(u.y - 5),
        scale,
        u.facing === -1
      );
    }

    // Active pixel VFX overlays
    const k1Hex = FLAGSHIP_SIX_KINGDOMS[sim.kingdomId]?.primaryHex;
    for (const v of sim.vfx) {
      const f = Math.min(3, Math.floor((v.elapsedMs / Math.max(1, v.lifetimeMs)) * 4));
      const vKey = `v|${v.effectId}|${f}|${k1Hex ?? ''}|${v.direction}`;
      const vfxBuf = getCached(vKey, () => renderVfxFrame(v.effectId, f, { k1Hex, direction: v.direction }));
      paintPixelBuffer(
        ctx,
        vfxBuf,
        Math.round(v.x - vfxBuf.width / 2),
        Math.round(v.y - vfxBuf.height / 2),
        scale,
        false
      );
    }
  };

  useEffect(() => {
    if (activeTab !== 'village') return;
    renderVillageToCanvas();
    if (!isPlaying || stepMode) return;
    let raf = 0;
    let last = performance.now();
    let uiSyncAcc = 0;
    const tick = (now: number) => {
      const dt = Math.min(60, Math.max(8, now - last)) * speedMult;
      last = now;
      stepVillageSimulation(simRef.current, dt);
      renderVillageToCanvas();
      uiSyncAcc += dt;
      if (uiSyncAcc >= 250) {
        uiSyncAcc = 0;
        setVillageStats({
          unitCount: simRef.current.units.length,
          vfxCount: simRef.current.vfx.length,
          simTimeSec: Number((simRef.current.simTimeMs / 1000).toFixed(1)),
        });
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [activeTab, isPlaying, stepMode, speedMult, villageRace, kingdomIdx, villageBurning]);

  const handleManualStep = (delta: number) => {
    setStepMode(true);
    setIsPlaying(false);
    setManualFrame((f) => (f + delta + 120) % 120);
    if (activeTab === 'village') {
      stepVillageSimulation(simRef.current, 160);
      renderVillageToCanvas();
      setVillageStats({
        unitCount: simRef.current.units.length,
        vfxCount: simRef.current.vfx.length,
        simTimeSec: Number((simRef.current.simTimeMs / 1000).toFixed(1)),
      });
    }
  };

  return (
    <section
      id="animations"
      data-testid="animations-and-village-section"
      className="scroll-mt-20 border-b border-[#26262B] bg-[#0B0B0D] py-16"
    >
      <div className="mx-auto max-w-[1280px] px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#EAB308]">
              Этап анимаций · Юниты, Животные, Постройки, VFX
            </span>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#F4F2ED] sm:text-3xl">
              Галерея «Анимации» и живая сцена «Деревня»
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[#A1A1AA]">
              Все 10 активных рас с индивидуальной пластикой движения, 205 моделей существ и построек, 5 пиксельных эффектов (≤8 цветов, 0 полупрозрачности) и симуляция 20 юнитов с боем.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="anim-tab-gallery"
              onClick={() => setActiveTab('gallery')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer ${
                activeTab === 'gallery'
                  ? 'bg-[#EAB308] text-[#0B0B0D]'
                  : 'border border-[#2C2C34] bg-[#141418] text-[#D4D2CD] hover:border-[#EAB308]'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Галерея «Анимации»</span>
            </button>
            <button
              type="button"
              data-testid="anim-tab-village"
              onClick={() => setActiveTab('village')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer ${
                activeTab === 'village'
                  ? 'bg-[#34D399] text-[#0B0B0D]'
                  : 'border border-[#2C2C34] bg-[#141418] text-[#D4D2CD] hover:border-[#34D399]'
              }`}
            >
              <Swords className="h-3.5 w-3.5" />
              <span>Сцена «Деревня» (20 юнитов + бой)</span>
            </button>
          </div>
        </div>

        {/* GLOBAL PLAYBACK BAR (1x/4x, Play/Pause, Step-by-Step) */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#26262B] bg-[#121216] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="anim-play-toggle"
              onClick={() => {
                setStepMode(false);
                setIsPlaying((p) => !p);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#EAB308] px-3 py-1.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] cursor-pointer"
            >
              {isPlaying && !stepMode ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{isPlaying && !stepMode ? 'Пауза' : 'Пуск'}</span>
            </button>

            <button
              type="button"
              data-testid="anim-speed-1x"
              onClick={() => setSpeedMult(1)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                speedMult === 1
                  ? 'bg-[#262630] text-[#F4F2ED] border border-[#EAB308]'
                  : 'border border-[#26262E] bg-[#18181D] text-[#A1A1AA]'
              }`}
            >
              1×
            </button>
            <button
              type="button"
              data-testid="anim-speed-4x"
              onClick={() => setSpeedMult(4)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                speedMult === 4
                  ? 'bg-[#262630] text-[#F4F2ED] border border-[#EAB308]'
                  : 'border border-[#26262E] bg-[#18181D] text-[#A1A1AA]'
              }`}
            >
              4×
            </button>

            <span className="mx-1 h-4 w-px bg-[#26262E]" />

            <button
              type="button"
              data-testid="anim-step-mode-btn"
              onClick={() => {
                setStepMode((s) => !s);
                setIsPlaying(false);
              }}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                stepMode
                  ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                  : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
              }`}
            >
              Покадровый режим
            </button>
            <button
              type="button"
              data-testid="anim-prev-frame-btn"
              onClick={() => handleManualStep(-1)}
              className="inline-flex items-center gap-1 rounded-md border border-[#26262E] bg-[#18181D] px-2 py-1.5 text-xs text-[#D4D2CD] hover:border-[#38BDF8] cursor-pointer"
              aria-label="Предыдущий кадр"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="anim-next-frame-btn"
              onClick={() => handleManualStep(1)}
              className="inline-flex items-center gap-1 rounded-md border border-[#26262E] bg-[#18181D] px-2 py-1.5 text-xs text-[#D4D2CD] hover:border-[#38BDF8] cursor-pointer"
              aria-label="Следующий кадр"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[#A1A1AA]">
            <span>Королевство:</span>
            {FLAGSHIP_SIX_KINGDOMS.map((k, i) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKingdomIdx(i)}
                title={k.name}
                className={`h-5 w-5 rounded border cursor-pointer ${
                  kingdomIdx === i ? 'border-[#F4F2ED] ring-2 ring-[#EAB308]' : 'border-[#2C2C34]'
                }`}
                style={{ backgroundColor: k.primaryHex }}
                aria-label={`Королевство ${k.name}`}
              />
            ))}
          </div>
        </div>

        {/* ================================================================ */}
        {/* TAB 1: ANIMATIONS GALLERY                                        */}
        {/* ================================================================ */}
        {activeTab === 'gallery' && (
          <div className="mt-6 space-y-6">
            {/* 1A: ALL-RACE UNIT ANIMATOR */}
            <div className="grid gap-6 lg:grid-cols-12 rounded-xl border border-[#26262B] bg-[#121216] p-5">
              <div className="lg:col-span-4 flex flex-col items-center justify-between rounded-lg border border-[#24242B] bg-[#16161B] p-4">
                <div className="flex w-full items-center justify-between text-xs text-[#A1A1AA]">
                  <span>
                    {ALL_UNIT_RACE_LABELS[unitRace]} · {unitRace === 'hive-mind' ? 'Без ролей' : MEDIEVAL_ROLE_LABELS[unitRole]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAnchors((a) => !a)}
                    className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${
                      showAnchors
                        ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40'
                        : 'border border-[#2C2C34] text-[#8E8E98]'
                    }`}
                  >
                    Якоря
                  </button>
                </div>

                <div className="my-4 flex items-center justify-center rounded-lg bg-[#243627] p-6">
                  <PixelCanvasBox
                    buf={currentUnit.buffer}
                    scale={14}
                    anchors={currentUnit.profile.anchors}
                    showAnchors={showAnchors}
                    testId="anim-gallery-unit-preview"
                    ariaLabel={`Анимация ${ALL_UNIT_RACE_LABELS[unitRace]} ${unitAction}`}
                  />
                </div>

                {/* Strip frames 0..N-1 */}
                <div className="flex w-full items-center justify-center gap-2">
                  {unitStripFrames.map((fr, idx) => (
                    <button
                      key={`fr-${idx}`}
                      type="button"
                      data-testid={`anim-frame-btn-${idx}`}
                      onClick={() => {
                        setStepMode(true);
                        setIsPlaying(false);
                        setManualFrame(idx);
                      }}
                      className={`flex flex-col items-center rounded border p-1.5 cursor-pointer ${
                        activeFrameIdx === idx
                          ? 'border-[#EAB308] bg-[#EAB308]/15'
                          : 'border-[#24242B] bg-[#1A1A21]'
                      }`}
                    >
                      <PixelCanvasBox buf={fr.buffer} scale={4} />
                      <span className="mt-1 text-[10px] text-[#A1A1AA]">
                        К{idx + 1} · {unitSpec.frameDurationsMs[idx]}мс
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-3 w-full rounded bg-[#111115] px-3 py-2 text-[11px] text-[#A1A1AA] flex flex-wrap justify-between gap-2">
                  <span>Цветов: {currentUnit.audit.uniqueColors}/8</span>
                  <span>INK: {currentUnit.audit.inkPixels}</span>
                  <span>Рука R: ({currentUnit.profile.anchors.hand.rightX},{currentUnit.profile.anchors.hand.rightY})</span>
                </div>
              </div>

              <div className="lg:col-span-8 space-y-4">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-[#A1A1AA]">Раса (все 10 рас и эпох)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ACTIVE_UNIT_RACES.map((rc) => (
                      <button
                        key={rc}
                        type="button"
                        data-testid={`anim-race-${rc}`}
                        onClick={() => setUnitRace(rc)}
                        className={`rounded-md px-2.5 py-1 text-xs cursor-pointer ${
                          unitRace === rc
                            ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                            : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD] hover:border-[#4A4A54]'
                        }`}
                      >
                        {ALL_UNIT_RACE_LABELS[rc]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-[#A1A1AA]">
                    Роль {unitRace === 'hive-mind' ? '(Улей-разум намеренно игнорирует роли)' : '(все 11 ролей)'}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_LIST.map((rl) => (
                      <button
                        key={rl}
                        type="button"
                        onClick={() => setUnitRole(rl)}
                        className={`rounded-md px-2 py-1 text-[11px] cursor-pointer ${
                          unitRole === rl
                            ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                            : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
                        }`}
                      >
                        {MEDIEVAL_ROLE_LABELS[rl]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-[#A1A1AA]">Действие (все 14 анимаций)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {UNIT_ANIMATION_ACTIONS.map((act) => {
                      const sp = getRaceActionSpec(unitRace, act);
                      return (
                        <button
                          key={act}
                          type="button"
                          data-testid={`anim-action-${act}`}
                          onClick={() => setUnitAction(act)}
                          className={`rounded-md px-2.5 py-1 text-[11px] cursor-pointer ${
                            unitAction === act
                              ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                              : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
                          }`}
                        >
                          {sp.label} ({sp.frameCount}к)
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-[#A1A1AA]">Перенос груза (поверх ходьбы)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {UNIT_CARRY_ITEMS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        data-testid={`anim-carry-${c.id}`}
                        onClick={() => {
                          setUnitCarry(c.id);
                          if (c.id !== 'none') setUnitAction('walk');
                        }}
                        className={`rounded-md px-2.5 py-1 text-[11px] cursor-pointer ${
                          unitCarry === c.id
                            ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                            : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Racial biomechanics comparison */}
                <div className="rounded-lg border border-[#24242B] bg-[#16161B] p-3">
                  <div className="mb-2 text-xs font-medium text-[#F4F2ED]">
                    Сравнение пластики рас в реальном времени ({unitAction})
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {GAIT_RACES.map((gr) => {
                      const gSpec = getRaceActionSpec(gr.race, unitAction);
                      const gFrame = activeFrameIdx % gSpec.frameCount;
                      const gUnit = generateProceduralUnit({
                        seed: 901,
                        era: getDefaultEraForRace(gr.race),
                        race: gr.race,
                        role: unitRole,
                        action: unitAction,
                        kingdomId: kingdomIdx,
                        frameIndex: gFrame,
                      });
                      return (
                        <div
                          key={gr.race}
                          className="flex items-center gap-2.5 rounded border border-[#26262E] bg-[#1B1B21] p-2"
                        >
                          <div className="rounded bg-[#243627] p-1">
                            <PixelCanvasBox buf={gUnit.buffer} scale={4} />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-[#F4F2ED]">
                              {ALL_UNIT_RACE_LABELS[gr.race]}
                            </div>
                            <div className="text-[10px] text-[#A1A1AA]">{gr.note}</div>
                            <div className="text-[10px] text-[#EAB308]">
                              {gSpec.frameDurationsMs[gFrame]} мс/к
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* 1B: CREATURE & BUILDING & VFX ANIMATION PANELS */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Animals / Creatures (Walk 4, Idle 2, Attack 4, Death 4 + Genes) */}
              <div className="rounded-xl border border-[#26262B] bg-[#121216] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-[#F4F2ED]">
                      Анимации животных и существ (все 205 моделей)
                    </h3>
                    <p className="text-xs text-[#A1A1AA]">
                      Локомоция: {currentCreature.locomotion === 'aquatic' ? 'Водная (плывёт)' : currentCreature.locomotion === 'flying' ? 'Летающая (машет крыльями)' : 'Наземная'} · работает с любым фенотипом
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {CREATURE_SHOWCASE_IDS.map((cid) => {
                    const m = modelById.get(cid);
                    return (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => setCreatureId(cid)}
                        className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                          creatureId === cid
                            ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                            : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
                        }`}
                      >
                        {m?.name ?? cid}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {CREATURE_ANIMATION_ACTIONS.map((ca) => (
                    <button
                      key={ca}
                      type="button"
                      data-testid={`creature-action-${ca}`}
                      onClick={() => setCreatureAction(ca)}
                      className={`rounded px-2.5 py-1 text-xs cursor-pointer ${
                        creatureAction === ca
                          ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                          : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
                      }`}
                    >
                      {CREATURE_ANIMATION_SPECS[ca].label} ({CREATURE_ANIMATION_SPECS[ca].frameCount}к)
                    </button>
                  ))}
                  <select
                    aria-label="Окрас животного"
                    value={creatureCoat}
                    onChange={(e) => setCreatureCoat(e.target.value as GeneCoat)}
                    className="rounded border border-[#2C2C34] bg-[#18181D] px-2 py-1 text-xs text-[#F4F2ED]"
                  >
                    <option value="natural">Природный</option>
                    <option value="dark">Тёмный</option>
                    <option value="albino">Альбинос</option>
                    <option value="striped">Полосатый</option>
                  </select>
                  <select
                    aria-label="Узор животного"
                    value={creaturePattern}
                    onChange={(e) => setCreaturePattern(e.target.value as GenePattern)}
                    className="rounded border border-[#2C2C34] bg-[#18181D] px-2 py-1 text-xs text-[#F4F2ED]"
                  >
                    <option value="solid">Сплошной</option>
                    <option value="striped">Полосы</option>
                    <option value="spotted">Пятна</option>
                    <option value="dappled">Крап</option>
                  </select>
                </div>

                <div className="flex items-center justify-center rounded-lg border border-[#24242B] bg-[#1C2A21] p-4 min-h-[168px]">
                  <PixelCanvasBox
                    buf={currentCreature.buffer}
                    scale={3}
                    testId="anim-gallery-creature-preview"
                    ariaLabel={creatureModel.name}
                  />
                </div>
              </div>

              {/* Buildings + Pixel VFX */}
              <div className="rounded-xl border border-[#26262B] bg-[#121216] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-[#F4F2ED]">
                      Постройки (дым, очаг, флаги, пожар) и VFX
                    </h3>
                    <p className="text-xs text-[#A1A1AA]">
                      Анимированные флаги K1/K2, огонь в очагах, дым и 5 эффектов ≤8 цветов.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="building-burning-toggle"
                    onClick={() => setBuildingBurning((b) => !b)}
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                      buildingBurning
                        ? 'bg-[#DC2626] text-[#F4F2ED]'
                        : 'border border-[#2C2C34] bg-[#18181D] text-[#D4D2CD]'
                    }`}
                  >
                    <Flame className="h-3.5 w-3.5" />
                    <span>{buildingBurning ? 'Горит!' : 'Горящее здание'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {BUILDING_ANIM_IDS.map((bid) => {
                    const bm = modelById.get(bid);
                    return (
                      <button
                        key={bid}
                        type="button"
                        onClick={() => setBuildingId(bid)}
                        className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                          buildingId === bid
                            ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                            : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
                        }`}
                      >
                        {bm?.name ?? bid}
                      </button>
                    );
                  })}
                  <select
                    aria-label="Состояние постройки"
                    value={buildingState}
                    onChange={(e) => setBuildingState(e.target.value as BuildingState)}
                    className="rounded border border-[#2C2C34] bg-[#18181D] px-2 py-1 text-xs text-[#F4F2ED]"
                  >
                    <option value="ready">Готово</option>
                    <option value="constructing">Строится</option>
                    <option value="damaged">Повреждено</option>
                    <option value="ruins">Руины</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col items-center justify-center rounded-lg border border-[#24242B] bg-[#1A2029] p-3">
                    <PixelCanvasBox
                      buf={currentBuilding.buffer}
                      scale={3}
                      testId="anim-gallery-building-preview"
                      ariaLabel={buildingModel.name}
                    />
                    <span className="mt-2 text-[11px] text-[#A1A1AA]">
                      {buildingModel.name} · Кадр {buildingFrameIdx + 1}/4
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {vfxEntries.map((v, idx) => (
                      <div
                        key={v.spec.id}
                        className={`flex flex-col items-center justify-center rounded border border-[#24242B] bg-[#16161B] p-2 ${
                          idx === vfxEntries.length - 1 ? 'col-span-2' : ''
                        }`}
                      >
                        <PixelCanvasBox buf={v.buf} scale={3} />
                        <span className="mt-1 text-[10.5px] font-medium text-[#F4F2ED]">
                          {v.spec.label}
                        </span>
                        <span className="text-[9.5px] text-[#34D399]">
                          {v.uniqueColors} цв · α=255
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 2: LIVE VILLAGE SCENE (20 UNITS + COMBAT + VFX + BENCHMARK)  */}
        {/* ================================================================ */}
        {activeTab === 'village' && (
          <div className="mt-6 rounded-xl border border-[#26262B] bg-[#121216] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222228] pb-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {ACTIVE_UNIT_RACES.map((rc) => (
                  <button
                    key={rc}
                    type="button"
                    data-testid={`village-race-${rc}`}
                    onClick={() => setVillageRace(rc)}
                    className={`rounded-md px-2.5 py-1 text-xs cursor-pointer ${
                      villageRace === rc
                        ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                        : 'border border-[#26262E] bg-[#18181D] text-[#D4D2CD]'
                    }`}
                  >
                    {ALL_UNIT_RACE_LABELS[rc]}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="village-burning-toggle"
                  onClick={() => setVillageBurning((b) => !b)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                    villageBurning
                      ? 'bg-[#DC2626] text-[#F4F2ED]'
                      : 'border border-[#2C2C34] bg-[#18181D] text-[#D4D2CD]'
                  }`}
                >
                  <Flame className="h-3.5 w-3.5" />
                  <span>{villageBurning ? 'Тушить пожар' : 'Горящее здание'}</span>
                </button>

                <button
                  type="button"
                  data-testid="village-benchmark-btn"
                  onClick={() => setBenchmark(benchmarkAnimatedUnits(10000))}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#EAB308]/50 bg-[#1B1912] px-3 py-1.5 text-xs font-semibold text-[#EAB308] hover:bg-[#EAB308] hover:text-[#0B0B0D] cursor-pointer"
                >
                  <Gauge className="h-3.5 w-3.5" />
                  <span>Тест: 10 000 анимир. юнитов</span>
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center">
              <canvas
                ref={villageCanvasRef}
                data-testid="village-live-canvas"
                aria-label="Сцена деревни с 20 анимированными юнитами и боем"
                style={{ imageRendering: 'pixelated' }}
                className="w-full max-w-[720px] rounded-lg border border-[#2C2C34] bg-[#1E2C3A]"
              />

              <div className="mt-3 flex w-full max-w-[720px] flex-wrap items-center justify-between gap-2 text-xs text-[#A1A1AA]">
                <span>
                  Юнитов одной расы: <strong className="text-[#F4F2ED]">{villageStats.unitCount}</strong> · Рубка, добыча, стройка, сбор, рыбалка, переноска и бой справа
                </span>
                <span>
                  Активных VFX: <strong className="text-[#38BDF8]">{villageStats.vfxCount}</strong> · Время: {villageStats.simTimeSec}с
                </span>
              </div>

              {benchmark && (
                <div
                  data-testid="village-benchmark-result"
                  className="mt-3 w-full max-w-[720px] rounded-lg border border-[#34D399]/40 bg-[#102119] px-4 py-2.5 text-xs text-[#D1FAE5]"
                >
                  Бенчмарк <strong>{benchmark.unitCount.toLocaleString('ru-RU')}</strong> анимированных юнитов: генерация клипов {benchmark.generateMs} мс · тик + блиттинг {benchmark.tickRenderMs} мс (~<strong>{benchmark.simulatedFps} FPS</strong>, спрайтов в кэше: {benchmark.uniqueSpriteCount})
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
