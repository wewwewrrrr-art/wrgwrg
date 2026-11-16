import { Crown, Dices, Grid, Pause, Play, RefreshCw, Shield, Timer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelBuffer } from '../engine/pixelCanvas';
import {
  ACTIVE_UNIT_ERAS,
  ACTIVE_UNIT_RACES,
  ALL_UNIT_RACE_LABELS,
  ActiveUnitRace,
  GeneratedHumanResult,
  MEDIEVAL_ROLE_LABELS,
  MedievalHumanRole,
  PAPER_DOLL_LAYERS,
  POWER_RANK_LABELS,
  PROCEDURAL_CANVAS_H,
  PROCEDURAL_CANVAS_W,
  PowerHierarchyRank,
  ProceduralAnchors,
  ProceduralAtlasBenchmarkResult,
  ProceduralHumanParams,
  UNIT_ANIMATION_ACTIONS,
  UNIT_ANIMATION_SPECS,
  UNIT_CARRY_ITEMS,
  UNIT_ERA_LABELS,
  UNIT_RACE_LABELS,
  UNIT_STATUS_LABELS,
  UnitAge,
  UnitAnimationAction,
  UnitCarryItem,
  UnitEra,
  UnitGender,
  UnitRace,
  UnitStatus,
  benchmarkProceduralUnitsToAtlas,
  generateMedievalCrowdGrid,
  generateProceduralMultiEraRaceGrid,
  generateProceduralUnit,
  getUnitActionSpec,
  normalizeActionFrameIndex,
} from '../engine/proceduralHuman';
import {
  HAIR_PALETTES_12,
  KINGDOM_PALETTES_84,
  SKIN_PALETTES_14,
} from '../engine/proceduralPalettes';
import type { PixelModelDef, StageBg } from '../models/types';
import { ProceduralWorldPanels } from './ProceduralWorldPanels';

interface ProceduralUnitForgeSectionProps {
  onInspectModel?: (model: PixelModelDef, initialTab?: 'preview' | 'code') => void;
}

function drawProceduralBuffer(
  canvas: HTMLCanvasElement | null,
  buf: PixelBuffer,
  scale: number,
  showGrid = false,
  anchors?: ProceduralAnchors
): void {
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

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const col = buf.getPixel(x, y);
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  if (showGrid && scale >= 4) {
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= buf.width; x++) {
      ctx.moveTo(x * scale + 0.5, 0);
      ctx.lineTo(x * scale + 0.5, h);
    }
    for (let y = 0; y <= buf.height; y++) {
      ctx.moveTo(0, y * scale + 0.5);
      ctx.lineTo(w, y * scale + 0.5);
    }
    ctx.stroke();
  }

  if (anchors && scale >= 6) {
    // feetY baseline
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, (anchors.feetY + 1) * scale - 1);
    ctx.lineTo(w, (anchors.feetY + 1) * scale - 1);
    ctx.stroke();

    // Left / right hand anchor outlines
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
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
}

interface ProceduralSpriteCanvasProps {
  buffer: PixelBuffer;
  scale: number;
  showGrid?: boolean;
  anchors?: ProceduralAnchors;
  ariaLabel?: string;
  testId?: string;
}

function ProceduralSpriteCanvas({
  buffer,
  scale,
  showGrid = false,
  anchors,
  ariaLabel,
  testId,
}: ProceduralSpriteCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    drawProceduralBuffer(ref.current, buffer, scale, showGrid, anchors);
  }, [buffer, scale, showGrid, anchors]);

  return (
    <canvas
      ref={ref}
      data-testid={testId}
      aria-label={ariaLabel}
      width={PROCEDURAL_CANVAS_W * scale}
      height={PROCEDURAL_CANVAS_H * scale}
      className="pixelated-canvas block"
    />
  );
}

const ERA_LIST = ACTIVE_UNIT_ERAS;
const RACE_LIST = ACTIVE_UNIT_RACES;
const ROLE_LIST = Object.keys(MEDIEVAL_ROLE_LABELS) as MedievalHumanRole[];
const RANK_LIST = Object.keys(POWER_RANK_LABELS) as PowerHierarchyRank[];
const STATUS_LIST = Object.keys(UNIT_STATUS_LABELS) as UnitStatus[];

const LAYER_LABELS_RU: Readonly<Record<(typeof PAPER_DOLL_LAYERS)[number], string>> = {
  body: '1. Тело',
  skin: '2. Кожа',
  faceEyes: '3. Лицо и глаза',
  hairBeard: '4. Волосы и борода',
  clothing: '5. Одежда (K1/K2)',
  armor: '6. Броня',
  headgear: '7. Головной убор',
  weaponTool: '8. Оружие / инстр.',
  statusSign: '9. Знаки статуса',
};

export function ProceduralUnitForgeSection({
  onInspectModel,
}: ProceduralUnitForgeSectionProps = {}) {
  const [seed, setSeed] = useState<number>(1042);
  const [era, setEra] = useState<UnitEra | 'auto'>('medieval');
  const [race, setRace] = useState<UnitRace | 'auto'>('human');
  const [gender, setGender] = useState<UnitGender | 'auto'>('auto');
  const [age, setAge] = useState<UnitAge | 'auto'>('auto');
  const [role, setRole] = useState<MedievalHumanRole | 'auto'>('king');
  const [powerRank, setPowerRank] = useState<PowerHierarchyRank | 'auto'>('auto');
  const [status, setStatus] = useState<UnitStatus | 'auto'>('healthy');
  const [kingdomId, setKingdomId] = useState<number | 'auto'>(0);
  const [alliedKingdomId, setAlliedKingdomId] = useState<number | 'auto'>(1);
  const [skinId, setSkinId] = useState<number | 'auto'>(2);
  const [hairId, setHairId] = useState<number | 'auto'>('auto');

  const [action, setAction] = useState<UnitAnimationAction>('walk');
  const [carry, setCarry] = useState<UnitCarryItem>('none');
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 4>(1);
  const [showAnchors, setShowAnchors] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [stageBg, setStageBg] = useState<StageBg>('meadow');
  const [showcaseEra, setShowcaseEra] = useState<UnitEra>('medieval');
  const [showcaseRace, setShowcaseRace] = useState<ActiveUnitRace>('marshfolk');
  const [gridMode, setGridMode] = useState<'medieval' | 'multi'>('multi');
  const [gridSeed, setGridSeed] = useState<number>(2026);
  const [selectedGridIdx, setSelectedGridIdx] = useState<number | null>(null);
  const [benchResult, setBenchResult] = useState<ProceduralAtlasBenchmarkResult | null>(null);

  const actionSpec = useMemo(() => getUnitActionSpec(action), [action]);
  const safeFrameIndex = normalizeActionFrameIndex(action, frameIndex);

  useEffect(() => {
    if (!isPlaying) return;
    const rawMs = actionSpec.frameDurationsMs[safeFrameIndex] ?? 160;
    const delayMs = Math.max(40, Math.round(rawMs / speedMultiplier));
    const timer = window.setTimeout(() => {
      setFrameIndex((f) => (normalizeActionFrameIndex(action, f) + 1) % actionSpec.frameCount);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [isPlaying, action, actionSpec, safeFrameIndex, speedMultiplier]);

  const currentParams: ProceduralHumanParams = useMemo(
    () => ({
      seed,
      era,
      race,
      gender,
      age,
      role,
      powerRank,
      status,
      kingdomId,
      alliedKingdomId,
      skinId,
      hairId,
      frameIndex: safeFrameIndex,
      action,
      carry,
    }),
    [
      seed,
      era,
      race,
      gender,
      age,
      role,
      powerRank,
      status,
      kingdomId,
      alliedKingdomId,
      skinId,
      hairId,
      safeFrameIndex,
      action,
      carry,
    ]
  );

  const generated = useMemo<GeneratedHumanResult>(
    () => generateProceduralUnit(currentParams),
    [currentParams]
  );

  const medievalDemoStrip = useMemo(() => {
    const kId = kingdomId === 'auto' ? 0 : kingdomId;
    const demoConfigs: readonly {
      readonly action: UnitAnimationAction;
      readonly role: MedievalHumanRole;
      readonly title: string;
    }[] = [
      { action: 'walk', role: 'warrior', title: 'Ходьба (4 кадра)' },
      { action: 'attack-melee', role: 'warrior', title: 'Удар (4 кадра)' },
      { action: 'death', role: 'warrior', title: 'Смерть (4 кадра)' },
      { action: 'chop', role: 'worker', title: 'Рубка (4 кадра)' },
    ];
    return demoConfigs.map((cfg) => {
      const fIdx = normalizeActionFrameIndex(cfg.action, frameIndex);
      const unit = generateProceduralUnit({
        seed: 1042,
        era: 'medieval',
        race: 'human',
        gender: 'male',
        age: 'adult',
        role: cfg.role,
        powerRank: 'none',
        status: 'healthy',
        kingdomId: kId,
        skinId: skinId === 'auto' ? 2 : skinId,
        hairId: 1,
        action: cfg.action,
        carry: 'none',
        frameIndex: fIdx,
      });
      return { ...cfg, frameIndex: fIdx, unit };
    });
  }, [frameIndex, kingdomId, skinId]);

  const crowdGrid = useMemo(
    () =>
      gridMode === 'multi'
        ? generateProceduralMultiEraRaceGrid(gridSeed, 100)
        : generateMedievalCrowdGrid(gridSeed, 100),
    [gridSeed, gridMode]
  );

  const tenRaceComparison = useMemo(() => {
    return ACTIVE_UNIT_RACES.map((rc) => {
      const unit = generateProceduralUnit({
        seed: 4444,
        era: rc === 'hive-mind' ? 'primordial' : rc === 'raptor-kin' ? 'dinosaurs' : rc === 'neanderthal' ? 'ice-age' : 'medieval',
        race: rc,
        gender: 'male',
        age: 'adult',
        role: 'warrior',
        kingdomId: 1,
        status: 'healthy',
        frameIndex: 0,
      });
      const mono = new PixelBuffer(PROCEDURAL_CANVAS_W, PROCEDURAL_CANVAS_H);
      for (let y = 0; y < PROCEDURAL_CANVAS_H; y++) {
        for (let x = 0; x < PROCEDURAL_CANVAS_W; x++) {
          if (unit.buffer.getPixel(x, y) !== null) {
            mono.setPixel(x, y, '#E4E2DD');
          }
        }
      }
      return {
        race: rc,
        label: UNIT_RACE_LABELS[rc],
        unit,
        mono,
      };
    });
  }, []);

  const inspectedSystemRace: UnitRace =
    race !== 'auto' ? race : generated.profile.race;

  const raceSystemMatrix = useMemo(() => {
    const kId = kingdomId === 'auto' ? 0 : kingdomId;
    const baseEra: UnitEra =
      inspectedSystemRace === 'hive-mind'
        ? 'primordial'
        : inspectedSystemRace === 'raptor-kin'
          ? 'dinosaurs'
          : inspectedSystemRace === 'neanderthal'
            ? 'ice-age'
            : era === 'auto'
              ? 'medieval'
              : era;
    const mk = (
      label: string,
      opts: Partial<ProceduralHumanParams>
    ) => ({
      label,
      res: generateProceduralUnit({
        seed: 5500,
        era: baseEra,
        race: inspectedSystemRace,
        gender: 'male',
        age: 'adult',
        role: 'warrior',
        powerRank: 'none',
        kingdomId: kId,
        alliedKingdomId: (kId + 2) % 6,
        status: 'healthy',
        frameIndex: 0,
        ...opts,
      }),
    });

    return {
      raceLabel: ALL_UNIT_RACE_LABELS[inspectedSystemRace],
      gendersAndAges: [
        mk('Мужчина', { gender: 'male', age: 'adult', role: 'peasant' }),
        mk('Женщина', { gender: 'female', age: 'adult', role: 'peasant' }),
        mk('Ребёнок', { gender: 'male', age: 'child', role: 'peasant' }),
        mk('Взрослый', { gender: 'male', age: 'adult', role: 'warrior' }),
        mk('Старик', { gender: 'male', age: 'elder', role: 'cleric' }),
      ],
      roles: ROLE_LIST.map((r) =>
        mk(MEDIEVAL_ROLE_LABELS[r], {
          role: r,
          gender: r === 'queen' ? 'female' : 'male',
          powerRank:
            r === 'king' || r === 'queen'
              ? 'king'
              : r === 'settlement-leader'
                ? 'village-leader'
                : 'none',
        })
      ),
      ranks: RANK_LIST.map((rk) =>
        mk(POWER_RANK_LABELS[rk], {
          role: rk === 'king' || rk === 'alliance-leader' ? 'king' : 'warrior',
          powerRank: rk,
        })
      ),
    };
  }, [inspectedSystemRace, era, kingdomId]);

  // 6 flagship kingdoms comparison: Alliance Leader, King, Queen, Child (at 4x) across any Era & Race
  const sixKingdomShowcase = useMemo(() => {
    return KINGDOM_PALETTES_84.slice(0, 6).map((k, idx) => {
      const alliedId = (idx + 3) % 6;
      const skinOverride = showcaseRace === 'human' ? (idx * 2) % 11 : 'auto';
      return {
        kingdom: k,
        allianceLeader: generateProceduralUnit({
          seed: 700 + idx,
          era: showcaseEra,
          race: showcaseRace,
          gender: 'male',
          age: 'adult',
          role: 'king',
          powerRank: 'alliance-leader',
          status: 'healthy',
          kingdomId: k.id,
          alliedKingdomId: alliedId,
          skinId: skinOverride,
          hairId: idx % 10,
          frameIndex: 0,
        }),
        king: generateProceduralUnit({
          seed: 710 + idx,
          era: showcaseEra,
          race: showcaseRace,
          gender: 'male',
          age: 'adult',
          role: 'king',
          powerRank: 'king',
          status: 'healthy',
          kingdomId: k.id,
          skinId: skinOverride,
          hairId: idx % 10,
          frameIndex: 0,
        }),
        queen: generateProceduralUnit({
          seed: 720 + idx,
          era: showcaseEra,
          race: showcaseRace,
          gender: 'female',
          age: 'adult',
          role: 'queen',
          powerRank: 'king',
          status: 'healthy',
          kingdomId: k.id,
          skinId: skinOverride,
          hairId: (idx + 2) % 10,
          frameIndex: 0,
        }),
        child: generateProceduralUnit({
          seed: 730 + idx,
          era: showcaseEra,
          race: showcaseRace,
          gender: idx % 2 === 0 ? 'male' : 'female',
          age: 'child',
          role: 'peasant',
          powerRank: 'none',
          status: 'healthy',
          kingdomId: k.id,
          skinId: skinOverride,
          hairId: (idx + 4) % 10,
          frameIndex: 0,
        }),
      };
    });
  }, [showcaseEra, showcaseRace]);

  const stageBgClass =
    stageBg === 'meadow'
      ? 'meadow-bg'
      : stageBg === 'parchment'
        ? 'bg-[#D6CBB3]'
        : 'bg-[#17171B]';

  const handleRandomizeUnit = () => {
    const nextSeed = Math.floor(Math.random() * 900000) + 1000;
    setSeed(nextSeed);
    setEra('auto');
    setRace('auto');
    setGender('auto');
    setAge('auto');
    setRole('auto');
    setPowerRank('auto');
    setStatus('auto');
    setKingdomId('auto');
    setAlliedKingdomId('auto');
    setSkinId('auto');
    setHairId('auto');
    setSelectedGridIdx(null);
  };

  const handleSelectFromGrid = (unit: GeneratedHumanResult, idx: number) => {
    setSelectedGridIdx(idx);
    setSeed(unit.profile.seed);
    setEra(unit.profile.era);
    setRace(unit.profile.race);
    setGender('auto');
    setAge('auto');
    setRole('auto');
    setPowerRank('auto');
    setStatus('auto');
    setKingdomId('auto');
    setAlliedKingdomId('auto');
    setSkinId('auto');
    setHairId('auto');
  };

  const handleRunBenchmark = () => {
    setBenchResult(benchmarkProceduralUnitsToAtlas(10000));
  };

  return (
    <section
      id="procedural-units"
      data-testid="procedural-unit-forge-section"
      className="scroll-mt-20 border-b border-[#26262B] bg-[#0B0B0D]"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        {/* Editorial Heading */}
        <div className="flex flex-col gap-5 border-b border-[#26262B] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium tracking-wide text-[#EAB308]">
              Полный генератор · 6 эпох · 10 оригинальных рас · 26 + 24 построек · 205 фенотипов
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#F4F2ED]">
              Процедурный генератор: 9 слоёв, 6 эпох, 10 рас и 84 державы
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
              Детерминированная сборка из{' '}
              <span className="text-[#F4F2ED] font-medium">9 фиксированных слоёв</span> на общем холсте
              10×10 для{' '}
              <span className="text-[#F4F2ED] font-medium">6 эпох и 10 уникальных рас</span> (силуэты различаются ≥ 15% без цвета),{' '}
              <span className="text-[#F4F2ED] font-medium">расовых палитр</span> и{' '}
              <span className="text-[#F4F2ED] font-medium">84 цветов держав</span> (CIELAB ΔE ≥ 12).
              Плюс перекраска всех 26 построек Средневековья и Бронзы, 24 зданий рас и фенотипы всех 205 моделей.
            </p>
          </div>

          <div className="flex items-center gap-6 text-right text-xs shrink-0">
            <div>
              <div className="font-mono text-xl font-bold text-[#F4F2ED] tabular-nums">6 × 10</div>
              <div className="text-[#8E8E98]">эпохи × расы</div>
            </div>
            <div>
              <div className="font-mono text-xl font-bold text-[#EAB308] tabular-nums">84</div>
              <div className="text-[#8E8E98]">держав (Lab)</div>
            </div>
            <div>
              <div className="font-mono text-xl font-bold text-[#F4F2ED] tabular-nums">205</div>
              <div className="text-[#8E8E98]">фенотипов</div>
            </div>
          </div>
        </div>

        {/* PART 1: INTERACTIVE GENERATOR & 4× / 12× STAGE */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT: 4× Real Scale + 12× Loupe + Layer & Anchor Audit */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="rounded-xl border border-[#26262C] bg-[#121216] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <div className="text-xs font-medium text-[#D4D2CD]">
                  Seed <span className="font-mono text-[#EAB308] tabular-nums">#{generated.profile.seed}</span>
                  {' · '}
                  <span>{ALL_UNIT_RACE_LABELS[generated.profile.race]}</span>
                  {' · '}
                  <span>
                    {generated.profile.race === 'hive-mind'
                      ? 'Без ролей (Улей)'
                      : MEDIEVAL_ROLE_LABELS[generated.profile.role]}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAnchors((a) => !a)}
                    aria-pressed={showAnchors}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] whitespace-nowrap cursor-pointer ${
                      showAnchors
                        ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                        : 'border border-[#26262C] bg-[#18181D] text-[#A1A1AA]'
                    }`}
                  >
                    <span>Якоря</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGrid((g) => !g)}
                    aria-pressed={showGrid}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] whitespace-nowrap cursor-pointer ${
                      showGrid
                        ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                        : 'border border-[#26262C] bg-[#18181D] text-[#A1A1AA]'
                    }`}
                  >
                    <Grid className="h-3 w-3" />
                    <span>Сетка</span>
                  </button>
                  <button
                    type="button"
                    data-testid="proc-speed-btn"
                    onClick={() => setSpeedMultiplier((s) => (s === 1 ? 4 : 1))}
                    className="rounded border border-[#26262C] bg-[#18181D] px-2 py-1 font-mono text-[11px] text-[#EAB308] cursor-pointer"
                  >
                    {speedMultiplier}×
                  </button>
                  <button
                    type="button"
                    data-testid="proc-play-btn"
                    onClick={() => setIsPlaying((p) => !p)}
                    className="inline-flex items-center gap-1 rounded border border-[#26262C] bg-[#18181D] px-2.5 py-1 text-[11px] text-[#F4F2ED] whitespace-nowrap cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    <span>{isPlaying ? 'Пауза' : actionSpec.label}</span>
                  </button>
                </div>
              </div>

              {/* Main Stage: 12× Loupe + True 4× + 1:1 */}
              <div
                className={`relative flex min-h-[200px] items-center justify-around gap-4 rounded-lg border border-[#26262B] px-4 py-6 ${stageBgClass}`}
              >
                <div className="flex flex-col items-center gap-2">
                  <ProceduralSpriteCanvas
                    buffer={generated.buffer}
                    scale={12}
                    showGrid={showGrid}
                    anchors={showAnchors ? generated.profile.anchors : undefined}
                    testId="proc-preview-12x"
                    ariaLabel={`Увеличенный спрайт 12x: ${MEDIEVAL_ROLE_LABELS[generated.profile.role]}`}
                  />
                  <span className="rounded bg-[#0B0B0D]/75 px-2 py-0.5 font-mono text-[10px] text-[#D4D2CD]">
                    12× · {actionSpec.label}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-3">
                  <div className="flex flex-col items-center gap-1.5 rounded border border-white/15 bg-[#0B0B0D]/75 px-3 py-2.5">
                    <ProceduralSpriteCanvas
                      buffer={generated.buffer}
                      scale={4}
                      testId="proc-preview-4x"
                      ariaLabel={`Спрайт 4x: ${MEDIEVAL_ROLE_LABELS[generated.profile.role]}`}
                    />
                    <span className="font-mono text-[10px] text-[#EAB308]">4× (40×40 px)</span>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-white/15 bg-[#0B0B0D]/75 px-2.5 py-1 text-[10px] text-[#D4D2CD]">
                    <span>1:1</span>
                    <ProceduralSpriteCanvas buffer={generated.buffer} scale={1} />
                  </div>
                </div>
              </div>

              {/* Stage bg & frame stepper */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1">
                  {Array.from({ length: actionSpec.frameCount }, (_, f) => (
                    <button
                      key={f}
                      type="button"
                      data-testid={`proc-frame-${f}`}
                      onClick={() => {
                        setIsPlaying(false);
                        setFrameIndex(f);
                      }}
                      className={`rounded px-2 py-1 font-mono text-[11px] cursor-pointer ${
                        safeFrameIndex === f
                          ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                          : 'bg-[#18181D] text-[#A1A1AA]'
                      }`}
                    >
                      К{f + 1}
                    </button>
                  ))}
                  <span className="ml-1 font-mono text-[10px] text-[#8E8E98]">
                    {actionSpec.frameDurationsMs[safeFrameIndex]}мс
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'meadow', label: 'Поляна' },
                      { id: 'dark', label: 'Тёмный' },
                      { id: 'parchment', label: 'Светлый' },
                    ] as const
                  ).map((bg) => (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => setStageBg(bg.id)}
                      className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                        stageBg === bg.id
                          ? 'bg-[#2E2E36] font-semibold text-[#F4F2ED]'
                          : 'bg-[#18181D] text-[#8E8E98]'
                      }`}
                    >
                      {bg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Animation Action (14) + Carry Overlay (3) */}
              <div className="mt-4 border-t border-[#222228] pt-3.5">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#F4F2ED]">
                    Анимации (Люди Средневековья · 14 действий)
                  </span>
                  <span className="font-mono text-[10px] text-[#8E8E98]">
                    {actionSpec.loop ? 'цикл' : 'разовая'} · {actionSpec.frameCount} к.
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {UNIT_ANIMATION_ACTIONS.map((act) => {
                    const spec = UNIT_ANIMATION_SPECS[act];
                    const selected = action === act;
                    return (
                      <button
                        key={act}
                        type="button"
                        data-testid={`proc-action-${act}`}
                        onClick={() => {
                          setAction(act);
                          setFrameIndex(0);
                          if (act !== 'walk') setCarry('none');
                          if (era !== 'medieval' || race !== 'human') {
                            setEra('medieval');
                            setRace('human');
                          }
                        }}
                        className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                          selected
                            ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                            : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                        }`}
                      >
                        {spec.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[11px] text-[#8E8E98]">Груз поверх ходьбы:</span>
                  {UNIT_CARRY_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`proc-carry-${item.id}`}
                      onClick={() => {
                        setCarry(item.id);
                        if (item.id !== 'none') {
                          setAction('walk');
                          setEra('medieval');
                          setRace('human');
                        }
                      }}
                      className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${
                        carry === item.id
                          ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Strict Pixel Audit & Shared Anchors */}
              <div className="mt-4 border-t border-[#222228] pt-4 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#8E8E98]">Цвета/кадр:</span>
                    <span
                      data-testid="proc-color-count"
                      className={`tabular-nums font-semibold ${
                        generated.audit.uniqueColors <= 8 ? 'text-[#34D399]' : 'text-[#EF4444]'
                      }`}
                    >
                      {generated.audit.uniqueColors} / 8
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8E8E98]">Рост (px):</span>
                    <span data-testid="proc-height-px" className="tabular-nums text-[#F4F2ED]">
                      {generated.audit.boundingBox.height} px
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8E8E98]">Полупрозрачных:</span>
                    <span className="tabular-nums text-[#F4F2ED]">
                      {generated.audit.semitransparentPixels}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8E8E98]">Пикселей-сирот:</span>
                    <span className="tabular-nums text-[#F4F2ED]">
                      {generated.audit.orphanPixels}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8E8E98]">Якорь головы:</span>
                    <span className="tabular-nums text-[#D4D2CD]">
                      ({generated.profile.anchors.head.x},{generated.profile.anchors.head.y})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8E8E98]">Руки L/R:</span>
                    <span className="tabular-nums text-[#D4D2CD]">
                      ({generated.profile.anchors.hand.leftX},{generated.profile.anchors.hand.leftY}) / ({generated.profile.anchors.hand.rightX},{generated.profile.anchors.hand.rightY})
                    </span>
                  </div>
                </div>

                {/* 9-Layer Fixed Order Strip */}
                <div className="mt-3 border-t border-[#222228] pt-3">
                  <div className="mb-1.5 text-[11px] font-medium text-[#8E8E98]">
                    Фиксированный порядок сборки (9 слоёв):
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[10px] text-[#D4D2CD]">
                    {generated.layerTrace.map((layer) => (
                      <div key={layer} className="truncate bg-[#17171C] px-2 py-1 rounded">
                        {LAYER_LABELS_RU[layer]}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 10,000 Unit Atlas Benchmark Trigger */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#222228] pt-3">
                  <button
                    type="button"
                    data-testid="proc-benchmark-btn"
                    onClick={handleRunBenchmark}
                    className="inline-flex items-center gap-1.5 rounded border border-[#2C2C34] bg-[#18181D] px-3 py-1.5 text-[11px] font-medium text-[#EAB308] hover:border-[#EAB308] cursor-pointer"
                  >
                    <Timer className="h-3.5 w-3.5" />
                    <span>Тест 10 000 юнитов в атлас</span>
                  </button>
                  {benchResult && (
                    <span data-testid="proc-benchmark-result" className="font-mono text-[11px] text-[#34D399] tabular-nums">
                      {benchResult.generatedCount.toLocaleString('ru-RU')} за {benchResult.elapsedMs} мс · {benchResult.pagesUsed} стр.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Parametric Generator Controls */}
          <div className="flex flex-col gap-3.5 lg:col-span-7">
            {/* Seed + Gender + Age + Status */}
            <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="proc-seed-input" className="text-xs font-semibold text-[#F4F2ED]">
                    Seed юнита:
                  </label>
                  <input
                    id="proc-seed-input"
                    data-testid="proc-seed-input"
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value) || 0)}
                    className="w-28 rounded border border-[#2C2C34] bg-[#18181D] px-2.5 py-1 font-mono text-xs text-[#F4F2ED] tabular-nums focus:border-[#EAB308] focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="proc-random-btn"
                    onClick={handleRandomizeUnit}
                    className="inline-flex items-center gap-1.5 rounded bg-[#EAB308] px-3 py-1.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] cursor-pointer whitespace-nowrap"
                  >
                    <Dices className="h-3.5 w-3.5" />
                    <span>Случайный</span>
                  </button>
                </div>
              </div>

              {/* Era & Race Selectors (Stage 2) */}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] text-[#8E8E98]">Эпоха</div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setEra('auto')}
                      className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                        era === 'auto'
                          ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                      }`}
                    >
                      Авто
                    </button>
                    {ERA_LIST.map((er) => (
                      <button
                        key={er}
                        type="button"
                        data-testid={`proc-era-${er}`}
                        onClick={() => setEra(er)}
                        className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                          era === er
                            ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                            : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                        }`}
                      >
                        {UNIT_ERA_LABELS[er]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[11px] text-[#8E8E98]">Оригинальные расы и эпохи (10 силуэтов)</div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setRace('auto')}
                      className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                        race === 'auto'
                          ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                      }`}
                    >
                      Авто
                    </button>
                    {RACE_LIST.map((rc) => (
                      <button
                        key={rc}
                        type="button"
                        data-testid={`proc-race-${rc}`}
                        onClick={() => setRace(rc)}
                        className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                          race === rc
                            ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                            : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                        }`}
                      >
                        {UNIT_RACE_LABELS[rc]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Gender */}
                <div>
                  <div className="mb-1 text-[11px] text-[#8E8E98]">Пол</div>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { id: 'auto', label: 'Авто' },
                        { id: 'male', label: 'Мужчина' },
                        { id: 'female', label: 'Женщина' },
                      ] as const
                    ).map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setGender(g.id)}
                        className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                          gender === g.id
                            ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                            : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Age */}
                <div>
                  <div className="mb-1 text-[11px] text-[#8E8E98]">Возраст (ребёнок 6–7 px)</div>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { id: 'auto', label: 'Авто' },
                        { id: 'child', label: 'Ребёнок' },
                        { id: 'adult', label: 'Взрослый' },
                        { id: 'elder', label: 'Старик' },
                      ] as const
                    ).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        data-testid={`proc-age-${a.id}`}
                        onClick={() => setAge(a.id)}
                        className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                          age === a.id
                            ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                            : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="mt-3">
                <div className="mb-1 text-[11px] text-[#8E8E98]">Статус (слой 9)</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setStatus('auto')}
                    className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                      status === 'auto'
                        ? 'bg-[#A78BFA] font-semibold text-[#0B0B0D]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                    }`}
                  >
                    Авто
                  </button>
                  {STATUS_LIST.map((st) => (
                    <button
                      key={st}
                      type="button"
                      data-testid={`proc-status-${st}`}
                      onClick={() => setStatus(st)}
                      className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                        status === st
                          ? 'bg-[#A78BFA] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                      }`}
                    >
                      {UNIT_STATUS_LABELS[st]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Roles & Power Hierarchy */}
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-[#F4F2ED]">
                  <span>Роль (11 силуэтов)</span>
                  {generated.profile.race === 'hive-mind' && (
                    <span className="rounded bg-[#34D399]/15 px-1.5 py-0.5 font-mono text-[10px] font-normal text-[#34D399]">
                      Улей без ролей
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setRole('auto')}
                    className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                      role === 'auto'
                        ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                    }`}
                  >
                    Авто
                  </button>
                  {ROLE_LIST.map((r) => (
                    <button
                      key={r}
                      type="button"
                      data-testid={`proc-role-${r}`}
                      onClick={() => setRole(r)}
                      className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                        role === r
                          ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                      }`}
                    >
                      {MEDIEVAL_ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#F4F2ED]">
                  <Crown className="h-3.5 w-3.5 text-[#EAB308]" />
                  <span>Иерархия власти (отдельный силуэт)</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setPowerRank('auto')}
                    className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                      powerRank === 'auto'
                        ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                    }`}
                  >
                    По роли
                  </button>
                  {RANK_LIST.map((rk) => (
                    <button
                      key={rk}
                      type="button"
                      data-testid={`proc-rank-${rk}`}
                      onClick={() => setPowerRank(rk)}
                      className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                        powerRank === rk
                          ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                      }`}
                    >
                      {POWER_RANK_LABELS[rk]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Skin (14 × 4-tone) & Hair (12 × 4-tone) */}
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#F4F2ED]">Кожа (14 палитр × 4 тона)</span>
                  <button
                    type="button"
                    onClick={() => setSkinId('auto')}
                    className={`rounded px-2 py-0.5 text-[10px] cursor-pointer ${
                      skinId === 'auto' ? 'bg-[#34D399] font-semibold text-[#0B0B0D]' : 'text-[#8E8E98]'
                    }`}
                  >
                    Авто
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {SKIN_PALETTES_14.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      title={s.name}
                      aria-label={`Кожа: ${s.name}`}
                      onClick={() => setSkinId(s.id)}
                      className={`h-6 w-full rounded border cursor-pointer ${
                        generated.profile.skin.id === s.id
                          ? 'border-[#F4F2ED] ring-1 ring-[#F4F2ED]'
                          : 'border-[#26262C] opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: s.ramp[1] }}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#F4F2ED]">Волосы (12 палитр, вкл. седину)</span>
                  <button
                    type="button"
                    onClick={() => setHairId('auto')}
                    className={`rounded px-2 py-0.5 text-[10px] cursor-pointer ${
                      hairId === 'auto' ? 'bg-[#34D399] font-semibold text-[#0B0B0D]' : 'text-[#8E8E98]'
                    }`}
                  >
                    Авто
                  </button>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {HAIR_PALETTES_12.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      title={h.name}
                      aria-label={`Волосы: ${h.name}`}
                      onClick={() => setHairId(h.id)}
                      className={`h-6 w-full rounded border cursor-pointer ${
                        generated.profile.hair.id === h.id
                          ? 'border-[#F4F2ED] ring-1 ring-[#F4F2ED]'
                          : 'border-[#26262C] opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: h.ramp[1] }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* 84 Kingdom Colors */}
            <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-[#F4F2ED]">
                  <Shield className="h-3.5 w-3.5 text-[#38BDF8]" />
                  <span>Державы: 84 различимых цвета (CIELAB ΔE ≥ 12)</span>
                </span>
                <span className="text-[11px] text-[#A1A1AA]">{generated.profile.kingdom.name}</span>
              </div>
              <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1 p-1 sm:grid-cols-[repeat(21,minmax(0,1fr))]">
                {KINGDOM_PALETTES_84.map((k) => {
                  const active = generated.profile.kingdom.id === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      title={k.name}
                      aria-label={k.name}
                      data-testid={`proc-kingdom-${k.id}`}
                      onClick={() => setKingdomId(k.id)}
                      className={`h-4 w-full rounded-xs cursor-pointer ${
                        active ? 'scale-125 ring-2 ring-[#F4F2ED] z-10' : 'opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: k.primaryHex }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* PART 1A: MEDIEVAL HUMAN ITEM-1 ANIMATION DEMO STRIP (ХОДЬБА · УДАР · СМЕРТЬ · РУБКА) */}
        <div
          data-testid="proc-medieval-anim-demo"
          className="mt-8 rounded-xl border border-[#26262B] bg-[#121216] p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222228] pb-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-[#F4F2ED]">
                Люди Средневековья — ключевые циклы анимаций (8×)
              </h3>
              <p className="mt-1 text-xs text-[#A1A1AA]">
                Ходьба, удар, смерть и рубка через 9 слоёв с динамическими якорями <span className="font-mono text-[#D4D2CD]">hand / feetY</span>. Нажмите карточку, чтобы открыть действие в инспекторе.
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-[#A1A1AA]">
              <span>Темп: {speedMultiplier}×</span>
              <span>·</span>
              <span>Кадр {safeFrameIndex + 1}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {medievalDemoStrip.map((item) => {
              const isSelected = action === item.action;
              return (
                <button
                  key={item.action}
                  type="button"
                  data-testid={`proc-demo-tile-${item.action}`}
                  onClick={() => {
                    setEra('medieval');
                    setRace('human');
                    setRole(item.role);
                    setAction(item.action);
                    setCarry('none');
                    setFrameIndex(0);
                  }}
                  className={`flex flex-col items-center gap-2.5 rounded-lg border p-3.5 transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[#EAB308] bg-[#EAB308]/10'
                      : 'border-[#24242B] bg-[#17171C] hover:border-[#3F3F4A]'
                  }`}
                >
                  <div className={`flex h-24 w-full items-center justify-center rounded border border-white/10 ${stageBgClass}`}>
                    <ProceduralSpriteCanvas
                      buffer={item.unit.buffer}
                      scale={8}
                      anchors={showAnchors ? item.unit.profile.anchors : undefined}
                      ariaLabel={item.title}
                    />
                  </div>
                  <div className="flex w-full items-center justify-between text-xs">
                    <span className="font-medium text-[#F4F2ED]">{item.title}</span>
                    <span className="font-mono text-[10px] text-[#EAB308]">
                      К{item.frameIndex + 1}/4
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* PART 1B: MONOCHROME + COLOR SILHOUETTE COMPARISON OF ALL 10 ACTIVE RACES */}
        <div
          data-testid="proc-ten-races-silhouettes"
          className="mt-8 rounded-xl border border-[#26262B] bg-[#121216] p-5"
        >
          <div className="border-b border-[#222228] pb-3">
            <h3 className="font-display text-lg font-semibold text-[#F4F2ED]">
              Все 10 оригинальных рас и доисторических видов: маска 10×10 без цвета и в цвете (4×)
            </h3>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              Каждый силуэт узнаётся на одноцветной маске непрозрачных пикселей (попарное отличие масок ≥ 15%). Нажмите любую расу, чтобы проверить пол, возраст, все 11 ролей и 5 рангов власти в 4× ниже.
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {tenRaceComparison.map((entry) => (
              <button
                key={entry.race}
                type="button"
                onClick={() => setRace(entry.race)}
                className={`flex flex-col items-center rounded-lg border p-2.5 text-center transition-colors cursor-pointer ${
                  inspectedSystemRace === entry.race
                    ? 'border-[#F472B6] bg-[#F472B6]/10'
                    : 'border-[#24242B] bg-[#16161B] hover:border-[#3A3A44]'
                }`}
              >
                <div className="flex items-center justify-center gap-2 rounded bg-[#243627] px-2.5 py-2">
                  <ProceduralSpriteCanvas buffer={entry.mono} scale={4} ariaLabel={`Маска: ${entry.label}`} />
                  <ProceduralSpriteCanvas buffer={entry.unit.buffer} scale={4} ariaLabel={`Раса: ${entry.label}`} />
                </div>
                <span className="mt-2 text-xs font-medium leading-tight text-[#F4F2ED]">
                  {entry.label}
                </span>
                <span className="font-mono text-[10px] text-[#8E8E98]">
                  {entry.unit.audit.opaquePixels}px · {entry.unit.audit.uniqueColors}цв
                </span>
              </button>
            ))}
          </div>

          {/* 4× System Verification Strip for the Selected Race */}
          <div
            data-testid="proc-race-system-strip"
            className="mt-5 rounded-lg border border-[#24242B] bg-[#16161B] p-4"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-[#F4F2ED]">
                  Единая система для расы «{raceSystemMatrix.raceLabel}» (масштаб 4×)
                </h4>
                <p className="text-[11px] text-[#A1A1AA]">
                  Пол, возраст, знаки власти и все 11 ролей (у «Улья-разума» роли намеренно отключены — особое существо без ролей).
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {RACE_LIST.map((rc) => (
                  <button
                    key={rc}
                    type="button"
                    onClick={() => setRace(rc)}
                    className={`rounded px-2 py-0.5 text-[10.5px] cursor-pointer ${
                      inspectedSystemRace === rc
                        ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                        : 'border border-[#26262E] bg-[#1B1B21] text-[#C4C2BD]'
                    }`}
                  >
                    {UNIT_RACE_LABELS[rc]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-[#8E8E98]">Пол и возраст + 5 рангов иерархии власти</div>
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                  {[...raceSystemMatrix.gendersAndAges, ...raceSystemMatrix.ranks].map((item, idx) => (
                    <div
                      key={`ga-rk-${idx}`}
                      className="flex flex-col items-center rounded border border-[#26262E] bg-[#1A1A21] p-1.5"
                    >
                      <div className="flex items-center justify-center rounded bg-[#243627] p-1">
                        <ProceduralSpriteCanvas buffer={item.res.buffer} scale={4} ariaLabel={item.label} />
                      </div>
                      <span className="mt-1 w-full truncate text-center text-[9.5px] text-[#D4D2CD]">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-medium text-[#8E8E98]">Все 11 ролей системы (4×)</div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
                  {raceSystemMatrix.roles.map((item) => (
                    <div
                      key={`role-${item.label}`}
                      className="flex flex-col items-center rounded border border-[#26262E] bg-[#1A1A21] p-1.5"
                    >
                      <div className="flex items-center justify-center rounded bg-[#243627] p-1">
                        <ProceduralSpriteCanvas buffer={item.res.buffer} scale={4} ariaLabel={item.label} />
                      </div>
                      <span className="mt-1 w-full truncate text-center text-[9.5px] text-[#D4D2CD]">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PART 2: SHOWCASE B — KING, QUEEN, ALLIANCE LEADER & CHILD IN 6 KINGDOMS (4× SCALE) */}
        <div
          data-testid="proc-six-kingdoms-showcase"
          className="mt-8 rounded-xl border border-[#26262B] bg-[#121216] p-5"
        >
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#222228] pb-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-[#F4F2ED]">
                Король, Королева, Лидер Альянса и Ребёнок в 6 королевствах (масштаб 4×)
              </h3>
              <p className="mt-1 text-xs text-[#A1A1AA]">
                Проверка читаемости силуэтов власти, роста ребёнка (6–7 px против 9–10 px у взрослых) и зональной перекраски K1/K2.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {ERA_LIST.map((er) => (
                <button
                  key={er}
                  type="button"
                  onClick={() => setShowcaseEra(er)}
                  className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                    showcaseEra === er
                      ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                      : 'border border-[#24242B] bg-[#17171C] text-[#A1A1AA]'
                  }`}
                >
                  {UNIT_ERA_LABELS[er]}
                </button>
              ))}
              {RACE_LIST.map((rc) => (
                <button
                  key={rc}
                  type="button"
                  onClick={() => setShowcaseRace(rc)}
                  className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                    showcaseRace === rc
                      ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                      : 'border border-[#24242B] bg-[#17171C] text-[#A1A1AA]'
                  }`}
                >
                  {UNIT_RACE_LABELS[rc]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {sixKingdomShowcase.map((entry) => (
              <div
                key={entry.kingdom.id}
                className="flex flex-col rounded-lg border border-[#24242B] bg-[#16161B] p-3"
              >
                <div className="flex items-center justify-between gap-2 pb-2">
                  <span className="truncate text-xs font-medium text-[#F4F2ED]">
                    {entry.kingdom.name}
                  </span>
                  <span
                    className="h-3 w-3 shrink-0 rounded-xs"
                    style={{ backgroundColor: entry.kingdom.primaryHex }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="flex flex-col items-center gap-1 rounded bg-[#243627] p-2">
                    <ProceduralSpriteCanvas buffer={entry.allianceLeader.buffer} scale={4} />
                    <span className="text-[10px] text-[#EAB308]">Альянс</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 rounded bg-[#243627] p-2">
                    <ProceduralSpriteCanvas buffer={entry.king.buffer} scale={4} />
                    <span className="text-[10px] text-[#D4D2CD]">Король</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 rounded bg-[#243627] p-2">
                    <ProceduralSpriteCanvas buffer={entry.queen.buffer} scale={4} />
                    <span className="text-[10px] text-[#D4D2CD]">Королева</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 rounded bg-[#243627] p-2">
                    <ProceduralSpriteCanvas buffer={entry.child.buffer} scale={4} />
                    <span className="text-[10px] text-[#8E8E98]">Ребёнок</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PART 3: SHOWCASE A — 10×10 GRID OF 100 RANDOM UNITS (4× SCALE) */}
        <div
          data-testid="proc-10x10-grid"
          className="mt-8 rounded-xl border border-[#26262B] bg-[#121216] p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222228] pb-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-[#F4F2ED]">
                Сетка 10×10: 100 случайных юнитов ({gridMode === 'multi' ? 'все 6 эпох и 10 рас' : 'Средневековье'}) — 4×
              </h3>
              <p className="mt-1 text-xs text-[#A1A1AA]">
                Нажмите на любого юнита, чтобы загрузить его seed, эпоху и расу в инспектор сверху.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGridMode('medieval')}
                className={`rounded px-2.5 py-1.5 text-xs cursor-pointer ${
                  gridMode === 'medieval'
                    ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                    : 'border border-[#2C2C34] bg-[#18181D] text-[#A1A1AA]'
                }`}
              >
                Люди Средневековья
              </button>
              <button
                type="button"
                onClick={() => setGridMode('multi')}
                className={`rounded px-2.5 py-1.5 text-xs cursor-pointer ${
                  gridMode === 'multi'
                    ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                    : 'border border-[#2C2C34] bg-[#18181D] text-[#A1A1AA]'
                }`}
              >
                6 эпох + 10 рас
              </button>
              <button
                type="button"
                data-testid="proc-shuffle-grid-btn"
                onClick={() => setGridSeed((s) => s + 137)}
                className="inline-flex items-center gap-1.5 rounded border border-[#2C2C34] bg-[#18181D] px-3 py-1.5 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Перемешать 100 юнитов</span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {crowdGrid.map((unit, idx) => {
              const isSelected = selectedGridIdx === idx;
              return (
                <button
                  key={`${unit.profile.seed}-${idx}`}
                  type="button"
                  onClick={() => handleSelectFromGrid(unit, idx)}
                  title={`#${unit.profile.seed} · ${UNIT_ERA_LABELS[unit.profile.era]} · ${ALL_UNIT_RACE_LABELS[unit.profile.race]} · ${MEDIEVAL_ROLE_LABELS[unit.profile.role]} · ${unit.profile.kingdom.name}`}
                  aria-label={`Юнит #${unit.profile.seed}: ${ALL_UNIT_RACE_LABELS[unit.profile.race]} ${MEDIEVAL_ROLE_LABELS[unit.profile.role]}`}
                  className={`flex flex-col items-center justify-center rounded border p-1.5 transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[#EAB308] bg-[#EAB308]/15'
                      : 'border-[#2B332D] bg-[#243627] hover:border-[#4A4A54]'
                  }`}
                >
                  <ProceduralSpriteCanvas buffer={unit.buffer} scale={4} />
                </button>
              );
            })}
          </div>
        </div>

        {/* PARTS 4, 5, 6: BUILDINGS IN 6 KINGDOMS, ANIMAL PHENOTYPES & JSON/PNG ATLAS EXPORT */}
        <ProceduralWorldPanels onInspectModel={onInspectModel} />
      </div>
    </section>
  );
}
