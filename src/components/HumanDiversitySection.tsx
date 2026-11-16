import {
  Baby,
  Crown,
  Dna,
  Eye,
  Grid,
  Pause,
  Play,
  RefreshCw,
  Shield,
  Skull,
  Sparkles,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CrowdCitizen,
  CrowdScenario,
  HUMAN_CANVAS_H,
  HUMAN_CANVAS_W,
  HUMAN_CULTURES,
  HUMAN_KINGDOM_COLORS_88,
  HUMAN_SKIN_COLORS_52,
  HumanAgeStage,
  HumanAppearanceSpec,
  HumanMutation,
  HumanRole,
  buildHumanCrowd,
  createChildFromParents,
  createHumanFromId,
  describeHumanLayers,
  getHumanDiversitySummary,
  renderHumanSprite,
  stepHumanCrowd,
} from '../engine/humanDiversity';
import { calculateKingdomRamp, calculateSkinShades } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { UnitAction, UnitMode } from '../engine/unitAssembler';
import type { StageBg } from '../models/types';

function paintPixelBuffer(
  canvas: HTMLCanvasElement | null,
  buf: PixelBuffer,
  scale: number,
  showGrid = false
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
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
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
}

interface HumanCanvasViewProps {
  spec: HumanAppearanceSpec;
  scale: number;
  frame: number;
  mode?: UnitMode;
  action?: UnitAction;
  showShadow?: boolean;
  stageBg?: StageBg;
  partOnly?: 'full' | 'body' | 'head';
  showGrid?: boolean;
  showMarkers?: boolean;
  testId?: string;
  ariaLabel?: string;
}

function HumanSpriteCanvas({
  spec,
  scale,
  frame,
  mode = 'walk',
  action = 'normal',
  showShadow = true,
  stageBg = 'meadow',
  partOnly = 'full',
  showGrid = false,
  showMarkers = false,
  testId,
  ariaLabel,
}: HumanCanvasViewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const buf = renderHumanSprite(spec, {
      frameIndex: frame,
      totalFrames: 4,
      mode,
      action,
      showShadow,
      stageBg,
      partOnly,
      showMarkers,
    });
    paintPixelBuffer(ref.current, buf, scale, showGrid);
  }, [spec, scale, frame, mode, action, showShadow, stageBg, partOnly, showGrid, showMarkers]);

  return (
    <canvas
      ref={ref}
      data-testid={testId}
      aria-label={ariaLabel}
      width={HUMAN_CANVAS_W * scale}
      height={HUMAN_CANVAS_H * scale}
      className="pixelated-canvas block"
    />
  );
}

const ROLE_OPTIONS: { id: HumanRole; label: string }[] = [
  { id: 'man', label: 'Мужчина' },
  { id: 'woman', label: 'Женщина' },
  { id: 'warrior', label: 'Воин' },
  { id: 'king', label: 'Король' },
  { id: 'monarch', label: 'Монарх Альянса' },
  { id: 'leader', label: 'Лидер' },
  { id: 'child', label: 'Ребёнок' },
  { id: 'zombie', label: 'Зомби' },
];

const AGE_OPTIONS: { id: HumanAgeStage; label: string }[] = [
  { id: 'child', label: 'Ребёнок' },
  { id: 'adult', label: 'Взрослый' },
  { id: 'elder', label: 'Старик' },
];

const MUTATION_OPTIONS: { id: HumanMutation; label: string }[] = [
  { id: 'none', label: 'Нет' },
  { id: 'giant', label: 'Гигант' },
  { id: 'energized', label: 'Энергия' },
  { id: 'plague', label: 'Чума' },
  { id: 'fire_blood', label: 'Огн. кровь' },
];

const CROWD_W = 240;
const CROWD_H = 112;
const CROWD_SCALE = 3;

export function HumanDiversitySection() {
  const summary = useMemo(() => getHumanDiversitySummary(), []);

  // 6-Layer Inspector State
  const [spec, setSpec] = useState<HumanAppearanceSpec>(() => ({
    personalId: 1042,
    cultureId: 0,
    role: 'man',
    headVariant: 0,
    kingdomColorIdx: 0,
    skinColorIdx: 5,
    skinShade: 0,
    ageStage: 'adult',
    isZombie: false,
    mutation: 'none',
    isFestive: false,
  }));

  const [isPlaying, setIsPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [unitMode, setUnitMode] = useState<UnitMode>('walk');
  const [unitAction, setUnitAction] = useState<UnitAction>('normal');
  const [showGrid, setShowGrid] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);
  const [stageBg, setStageBg] = useState<StageBg>('meadow');
  const [kingdomSlot, setKingdomSlot] = useState<'primary' | 'allied'>('primary');

  // Family Inheritance Lab State
  const [parentA, setParentA] = useState<HumanAppearanceSpec>(() =>
    createHumanFromId(201, {
      cultureId: 0,
      role: 'man',
      kingdomColorIdx: 0,
      skinColorIdx: 2,
      skinShade: 1,
      ageStage: 'adult',
    })
  );
  const [parentB, setParentB] = useState<HumanAppearanceSpec>(() =>
    createHumanFromId(202, {
      cultureId: 4,
      role: 'woman',
      kingdomColorIdx: 0,
      skinColorIdx: 26,
      skinShade: 2,
      ageStage: 'adult',
    })
  );
  const [childSeed, setChildSeed] = useState(501);
  const [familyChild, setFamilyChild] = useState<HumanAppearanceSpec>(() =>
    createChildFromParents(
      createHumanFromId(201, { cultureId: 0, role: 'man', kingdomColorIdx: 0, skinColorIdx: 2, skinShade: 1, ageStage: 'adult' }),
      createHumanFromId(202, { cultureId: 4, role: 'woman', kingdomColorIdx: 0, skinColorIdx: 26, skinShade: 2, ageStage: 'adult' }),
      501,
      'man'
    )
  );

  // Live Top-Down Crowd Sandbox State
  const [crowdScenario, setCrowdScenario] = useState<CrowdScenario>('two-cultures-same-kingdom');
  const [selectedCrowdId, setSelectedCrowdId] = useState<number | null>(null);
  const crowdCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const crowdBgRef = useRef<HTMLCanvasElement | null>(null);
  const crowdCitizensRef = useRef<CrowdCitizen[]>(buildHumanCrowd('two-cultures-same-kingdom'));
  const crowdSpriteCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const isPlayingRef = useRef(isPlaying);
  const selectedCrowdIdRef = useRef(selectedCrowdId);
  isPlayingRef.current = isPlaying;
  selectedCrowdIdRef.current = selectedCrowdId;

  // Step preview frames cleanly (~7 fps for walk/attack)
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % 4);
    }, 155);
    return () => window.clearInterval(id);
  }, [isPlaying]);

const getCrowdPondDist = (tx: number, ty: number): number => {
  // 4×4 pixel shoreline sub-grid (60×28) over 8×8 sandbox map tiles
  const dx = (tx - 30) / 8.5;
  const dy = (ty - 27) / 6.8;
  const wobble = Math.sin(tx * 0.42) * 0.09 + Math.cos(ty * 0.55) * 0.08;
  return dx * dx + dy * dy + wobble;
};

const isCrowdWaterAtPixel = (px: number, py: number): boolean => {
  const tx = Math.floor(px / 4);
  const ty = Math.floor(py / 4);
  return getCrowdPondDist(tx, ty) < 0.88;
};

  // Pre-render 8×8 px sandbox grass tiles + smooth 4×4 sandy footpath & sand-rimmed cove
  useEffect(() => {
    const bg = document.createElement('canvas');
    bg.width = CROWD_W;
    bg.height = CROWD_H;
    const bctx = bg.getContext('2d');
    if (bctx) {
      for (let ty = 0; ty < CROWD_H / 4; ty++) {
        for (let tx = 0; tx < CROWD_W / 4; tx++) {
          const gx = tx >> 1;
          const gy = ty >> 1;
          const tileHash = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
          const subHash = ((tx * 83492791) ^ (ty * 2971215073)) >>> 0;
          const pondDist = getCrowdPondDist(tx, ty);
          const isDeepWater = pondDist < 0.56;
          const isShallowWater = pondDist >= 0.56 && pondDist < 0.88;
          const isBeach = pondDist >= 0.88 && pondDist < 1.24;
          const isRoad = Math.abs(ty - 13 - Math.round(Math.sin(tx * 0.12) * 1.5)) <= 1;

          if (isDeepWater) {
            bctx.fillStyle = subHash % 5 === 0 ? '#3675AC' : '#3C7FB8';
          } else if (isShallowWater) {
            bctx.fillStyle = subHash % 4 === 0 ? '#5BC5DE' : '#67D1E8';
          } else if (isBeach || isRoad) {
            bctx.fillStyle = subHash % 3 === 0 ? '#CCB478' : '#DFCA86';
          } else {
            bctx.fillStyle = tileHash % 4 === 0 ? '#529E36' : tileHash % 2 === 0 ? '#5EAD3D' : '#58A639';
          }
          bctx.fillRect(tx * 4, ty * 4, 4, 4);

          if (!isDeepWater && !isShallowWater && !isBeach && !isRoad) {
            if (tileHash % 3 === 0 && (tx & 1) === 0 && (ty & 1) === 0) {
              bctx.fillStyle = '#4E9432';
              bctx.fillRect(tx * 4 + 1, ty * 4 + 1, 2, 1);
            }
            if (subHash % 23 === 0) {
              bctx.fillStyle = subHash % 2 === 0 ? '#F2D644' : '#E8537C';
              bctx.fillRect(tx * 4 + 2, ty * 4 + 2, 1, 1);
            }
          }
        }
      }
    }
    crowdBgRef.current = bg;
  }, []);

  const handleSelectScenario = (next: CrowdScenario) => {
    setCrowdScenario(next);
    crowdCitizensRef.current = buildHumanCrowd(next);
    setSelectedCrowdId(null);
  };

  const handleToggleOutbreak = (infect: boolean) => {
    for (let i = 0; i < crowdCitizensRef.current.length; i++) {
      const c = crowdCitizensRef.current[i];
      const shouldInfect = infect ? i % 4 === 0 : false;
      crowdCitizensRef.current[i] = {
        ...c,
        spec: {
          ...c.spec,
          isZombie: shouldInfect,
        },
      };
    }
  };

  // Live 60fps Top-Down Crowd Render Loop
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();

    const drawCrowd = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;

      if (isPlayingRef.current) {
        stepHumanCrowd(crowdCitizensRef.current, dt, CROWD_W, CROWD_H);
      }

      const canvas = crowdCanvasRef.current;
      const bg = crowdBgRef.current;
      if (canvas && bg) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);

          const sorted = [...crowdCitizensRef.current].sort((a, b) => a.y - b.y);
          const cache = crowdSpriteCacheRef.current;
          if (cache.size > 800) cache.clear();

          for (const cit of sorted) {
            const s = cit.spec;
            const fr = Math.floor(cit.walkPhase) % 4;
            const mode: UnitMode = isCrowdWaterAtPixel(cit.x, cit.y) ? 'swim' : 'walk';
            const cacheKey = `${s.personalId}|${s.cultureId}|${s.role}|${s.headVariant}|${s.kingdomColorIdx}|${s.alliedKingdomColorIdx ?? -1}|${s.skinColorIdx}|${s.skinShade}|${s.ageStage}|${s.isZombie}|${s.mutation}|${mode}|${fr}`;
            let spriteCanvas = cache.get(cacheKey);
            if (!spriteCanvas) {
              const buf = renderHumanSprite(s, {
                frameIndex: fr,
                totalFrames: 4,
                mode,
                action: 'normal',
                showShadow: mode !== 'swim',
                stageBg: 'meadow',
              });
              const off = document.createElement('canvas');
              off.width = buf.width;
              off.height = buf.height;
              const octx = off.getContext('2d');
              if (octx) {
                const img = octx.createImageData(buf.width, buf.height);
                img.data.set(buf.toRgbaBytes());
                octx.putImageData(img, 0, 0);
              }
              spriteCanvas = off;
              cache.set(cacheKey, spriteCanvas);
            }

            const dx = Math.round(cit.x - HUMAN_CANVAS_W / 2) * CROWD_SCALE;
            const dy = Math.round(cit.y - HUMAN_CANVAS_H + 1) * CROWD_SCALE;
            const dw = HUMAN_CANVAS_W * CROWD_SCALE;
            const dh = HUMAN_CANVAS_H * CROWD_SCALE;

            if (cit.facing === 1) {
              ctx.save();
              ctx.translate(dx + dw, dy);
              ctx.scale(-1, 1);
              ctx.drawImage(spriteCanvas, 0, 0, dw, dh);
              ctx.restore();
            } else {
              ctx.drawImage(spriteCanvas, dx, dy, dw, dh);
            }

            if (selectedCrowdIdRef.current === s.personalId) {
              ctx.strokeStyle = '#EAB308';
              ctx.lineWidth = 2;
              ctx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);
            }
          }
        }
      }

      rafId = requestAnimationFrame(drawCrowd);
    };

    rafId = requestAnimationFrame(drawCrowd);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleCrowdClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * CROWD_W;
    const ly = ((e.clientY - rect.top) / Math.max(1, rect.height)) * CROWD_H;

    let best: CrowdCitizen | null = null;
    let bestD = 14;
    for (const c of crowdCitizensRef.current) {
      const cy = c.y - 5;
      const d = Math.hypot(c.x - lx, cy - ly);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      setSelectedCrowdId(best.spec.personalId);
      setSpec(best.spec);
    }
  };

  const handleSpawnChild = () => {
    const nextSeed = childSeed + 1;
    setChildSeed(nextSeed);
    const born = createChildFromParents(parentA, parentB, nextSeed, nextSeed % 2 === 0 ? 'man' : 'woman');
    setFamilyChild(born);
  };

  const handleCycleChildLife = () => {
    setFamilyChild((prev) => {
      if (prev.isZombie) {
        return { ...prev, isZombie: false, ageStage: 'child' };
      }
      if (prev.ageStage === 'child') {
        return { ...prev, ageStage: 'adult' };
      }
      if (prev.ageStage === 'adult') {
        return { ...prev, ageStage: 'elder' };
      }
      return { ...prev, isZombie: true };
    });
  };

  const layersInfo = useMemo(() => describeHumanLayers(spec), [spec]);
  const kingdomRamp = useMemo(
    () => calculateKingdomRamp(layersInfo.kingdomColor.primaryHex),
    [layersInfo.kingdomColor.primaryHex]
  );
  const alliedKingdomRamp = useMemo(
    () =>
      layersInfo.alliedKingdomColor
        ? calculateKingdomRamp(layersInfo.alliedKingdomColor.primaryHex)
        : null,
    [layersInfo.alliedKingdomColor]
  );
  const skinRamp = useMemo(
    () =>
      calculateSkinShades(
        layersInfo.skinColor.fromHex,
        layersInfo.skinColor.toHex,
        spec.skinShade
      ),
    [layersInfo.skinColor, spec.skinShade]
  );

  const stageBgClass =
    stageBg === 'meadow'
      ? 'meadow-bg'
      : stageBg === 'checker'
        ? 'checker-bg'
        : stageBg === 'parchment'
          ? 'bg-[#D6CBB3]'
          : 'bg-[#17171B]';

  const childInheritedFrom =
    familyChild.skinColorIdx === parentA.skinColorIdx ? 'от Отца (Родитель А)' : 'от Матери (Родитель Б)';

  return (
    <section
      id="humans"
      data-testid="human-diversity-section"
      className="border-b border-[#26262B] bg-[#0B0B0D]"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        {/* Section Heading & Combinatorial Formula */}
        <div className="flex flex-col gap-5 border-b border-[#26262B] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium tracking-wide text-[#EAB308]">
              Вид «Человек» · Модульная система 10×10 px · Пока только люди
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#F4F2ED]">
              Разнообразие внешности: 6 независимых слоёв
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
              Нарисовано всего <strong className="text-[#F4F2ED]">{summary.bodiesCount}</strong> тела и{' '}
              <strong className="text-[#F4F2ED]">{summary.headsCount}</strong> головы, но при перемножении
              слоёв (Народ × Роль × Голова × {summary.kingdomColors} цветов державы × {summary.skinColors} кожи ×{' '}
              {summary.skinShades} оттенка × Возраст/Мутации) получаются{' '}
              <strong className="text-[#EAB308]">
                {(summary.totalCombinations / 1_000_000).toFixed(1)} млн+
              </strong>{' '}
              различимых жителей, мгновенно читаемых сверху.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#24242A] bg-[#131317] p-3 text-center text-xs shrink-0">
            <div>
              <div className="font-mono text-lg font-bold text-[#F4F2ED] tabular-nums">
                {summary.bodiesCount}
              </div>
              <div className="text-[11px] text-[#8E8E98]">тел (10×10)</div>
            </div>
            <div>
              <div className="font-mono text-lg font-bold text-[#F4F2ED] tabular-nums">
                {summary.headsCount}
              </div>
              <div className="text-[11px] text-[#8E8E98]">голов</div>
            </div>
            <div>
              <div className="font-mono text-lg font-bold text-[#EAB308] tabular-nums">
                88×52×4
              </div>
              <div className="text-[11px] text-[#8E8E98]">державы × кожа</div>
            </div>
          </div>
        </div>

        {/* Main Studio Grid: Preview + Layer Dissection (Left) | 6 Layer Controls (Right) */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT: Live 10×10 Stage + Exploded 6-Layer Dissection */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="rounded-2xl border border-[#26262C] bg-[#121216] p-5">
              <div className="flex items-center justify-between gap-2 pb-3">
                <div className="flex items-center gap-2 text-xs font-medium text-[#D4D2CD]">
                  <Eye className="h-3.5 w-3.5 text-[#EAB308]" />
                  <span>Житель #{spec.personalId} · {layersInfo.effectiveRole.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowMarkers((m) => !m)}
                    aria-pressed={showMarkers}
                    className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
                      showMarkers
                        ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                        : 'border border-[#26262C] bg-[#18181D] text-[#A1A1AA]'
                    }`}
                  >
                    Маркеры
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGrid((g) => !g)}
                    aria-pressed={showGrid}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] cursor-pointer ${
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
                    onClick={() => setIsPlaying((p) => !p)}
                    className="inline-flex items-center gap-1 rounded border border-[#26262C] bg-[#18181D] px-2 py-1 text-[11px] text-[#F4F2ED] cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    <span>{isPlaying ? 'Пауза' : 'Пуск'}</span>
                  </button>
                </div>
              </div>

              {/* Hero 10x10 Scaled Canvas Stage + 1:1 true world scale badge */}
              <div
                className={`relative flex min-h-[190px] items-center justify-center rounded-xl border border-[#26262B] ${stageBgClass}`}
              >
                <HumanSpriteCanvas
                  spec={spec}
                  scale={12}
                  frame={frame}
                  mode={unitMode}
                  action={unitAction}
                  showShadow
                  stageBg={stageBg}
                  showGrid={showGrid}
                  showMarkers={showMarkers}
                  testId="human-main-canvas"
                  ariaLabel={`Спрайт человека: ${layersInfo.bodyLabel}, ${layersInfo.headLabel}`}
                />
                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2 rounded border border-white/15 bg-[#0B0B0D]/75 px-2 py-1 text-[10px] text-[#D4D2CD]">
                  <span>1:1</span>
                  <HumanSpriteCanvas
                    spec={spec}
                    scale={1}
                    frame={frame}
                    mode={unitMode}
                    action={unitAction}
                    showShadow
                    stageBg={stageBg}
                  />
                </div>
              </div>

              {/* Action / Swim / Stage controls */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'walk', label: 'Суша' },
                      { id: 'swim', label: 'Вода' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setUnitMode(m.id)}
                      className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                        unitMode === m.id
                          ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                          : 'bg-[#18181D] text-[#A1A1AA]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                  {(
                    [
                      { id: 'normal', label: 'Шаг' },
                      { id: 'attack', label: 'Удар' },
                      { id: 'hit', label: 'Урон' },
                    ] as const
                  ).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setUnitAction(a.id)}
                      className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                        unitAction === a.id
                          ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                          : 'bg-[#18181D] text-[#A1A1AA]'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
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
                      className={`rounded px-2 py-1 text-[11px] cursor-pointer ${
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

              {/* Exploded Layer Dissection */}
              <div className="mt-4 border-t border-[#222228] pt-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8E8E98]">
                  Разборка независимых слоёв (Чей · Кто · Который · За кого · Откуда)
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2">
                  <div className="flex flex-col items-center rounded-lg border border-[#24242B] bg-[#16161B] p-2">
                    <span className="text-[10px] text-[#8E8E98]">Тело (1+2)</span>
                    <div className="my-1.5 flex h-16 items-center justify-center">
                      <HumanSpriteCanvas
                        spec={spec}
                        scale={5}
                        frame={frame}
                        mode={unitMode}
                        action="normal"
                        showShadow={false}
                        partOnly="body"
                        showMarkers={showMarkers}
                        testId="human-body-canvas"
                      />
                    </div>
                    <span className="w-full truncate text-center font-mono text-[10px] text-[#D4D2CD]">
                      {layersInfo.bodyKey}
                    </span>
                  </div>

                  <div className="flex flex-col items-center rounded-lg border border-[#24242B] bg-[#16161B] p-2">
                    <span className="text-[10px] text-[#8E8E98]">Голова (3)</span>
                    <div className="my-1.5 flex h-16 items-center justify-center">
                      <HumanSpriteCanvas
                        spec={spec}
                        scale={5}
                        frame={frame}
                        mode={unitMode}
                        action="normal"
                        showShadow={false}
                        partOnly="head"
                        testId="human-head-canvas"
                      />
                    </div>
                    <span className="w-full truncate text-center font-mono text-[10px] text-[#D4D2CD]">
                      {layersInfo.headKey}
                    </span>
                  </div>

                  <div className="flex flex-col items-center rounded-lg border border-[#24242B] bg-[#16161B] p-2">
                    <span className="text-[10px] text-[#8E8E98]">Маски (4+5)</span>
                    <div className="my-2 flex flex-col gap-1">
                      <div className="flex gap-0.5" title="4 оттенка цвета державы K1">
                        {kingdomRamp.map((hex) => (
                          <span
                            key={`k1-${hex}`}
                            className="h-3 w-3.5 rounded-xs border border-black/30"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                      {alliedKingdomRamp && (
                        <div className="flex gap-0.5" title="4 оттенка союзной державы Альянса K2">
                          {alliedKingdomRamp.map((hex) => (
                            <span
                              key={`k2-${hex}`}
                              className="h-3 w-3.5 rounded-xs border border-[#EAB308]/50"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                        </div>
                      )}
                      <div className="flex gap-0.5" title="4 оттенка кожи">
                        {skinRamp.map((hex) => (
                          <span
                            key={`sk-${hex}`}
                            className="h-3 w-3.5 rounded-xs border border-black/30"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="w-full truncate text-center font-mono text-[10px] text-[#D4D2CD]">
                      {layersInfo.alliedKingdomColor
                        ? `K#${spec.kingdomColorIdx + 1}+#${layersInfo.alliedKingdomColor.id + 1} · S#${spec.skinColorIdx + 1}`
                        : `K#${spec.kingdomColorIdx + 1} · S#${spec.skinColorIdx + 1}`}
                    </span>
                  </div>

                  <div className="flex flex-col items-center rounded-lg border border-[#EAB308]/40 bg-[#EAB308]/10 p-2">
                    <span className="text-[10px] text-[#EAB308]">Итог (6)</span>
                    <div className="my-1.5 flex h-16 items-center justify-center">
                      <HumanSpriteCanvas
                        spec={spec}
                        scale={5}
                        frame={frame}
                        mode={unitMode}
                        action={unitAction}
                        showShadow={false}
                        partOnly="full"
                      />
                    </div>
                    <span className="w-full truncate text-center font-mono text-[10px] text-[#F4F2ED]">
                      {spec.isZombie ? 'zombie' : spec.ageStage}
                    </span>
                  </div>
                </div>

                {/* Readable 6-question summary */}
                <dl
                  data-testid="human-layer-summary"
                  className="mt-3 space-y-1.5 rounded-lg border border-[#222228] bg-[#151519] p-3 text-xs"
                >
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#8E8E98]">1. Чей народ (костюм):</dt>
                    <dd className="text-right font-medium text-[#F4F2ED]">{layersInfo.cultureName}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#8E8E98]">2. Кто в обществе (тело):</dt>
                    <dd className="text-right font-medium text-[#F4F2ED]">{layersInfo.bodyLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#8E8E98]">3. Личность (голова ID#{spec.personalId}):</dt>
                    <dd className="text-right font-medium text-[#F4F2ED]">{layersInfo.headLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#8E8E98]">
                      {layersInfo.alliedKingdomColor ? '4. Альянс держав (K1 + K2):' : '4. Государство (цвет из 88):'}
                    </dt>
                    <dd className="text-right font-medium text-[#F4F2ED]">
                      {layersInfo.alliedKingdomColor
                        ? `${layersInfo.kingdomColor.name} + ${layersInfo.alliedKingdomColor.name}`
                        : layersInfo.kingdomColor.name}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#8E8E98]">5. Происхождение (из 52×4):</dt>
                    <dd className="text-right font-medium text-[#F4F2ED]">
                      {layersInfo.skinColor.name} · отт. {spec.skinShade + 1}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          {/* RIGHT: All 6 Independent Layer Controls */}
          <div className="flex flex-col gap-3.5 lg:col-span-7">
            {/* Layer 1: Culture (10 costumes) */}
            <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#F4F2ED]">
                  Слой 1 · Народ («чей это человек?») — 10 вариантов костюма
                </span>
                <span className="text-[11px] text-[#8E8E98]">{HUMAN_CULTURES[spec.cultureId].costumeDesc}</span>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {HUMAN_CULTURES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={`${c.id + 1}. ${c.name}`}
                    data-testid={`culture-btn-${c.id}`}
                    onClick={() => setSpec((prev) => ({ ...prev, cultureId: c.id }))}
                    className={`truncate rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors cursor-pointer ${
                      spec.cultureId === c.id
                        ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD] hover:border-[#4A4A54]'
                    }`}
                  >
                    {c.id + 1}. {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Layer 2: Role + Layer 3: Personal Head */}
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F4F2ED]">
                  <Crown className="h-3.5 w-3.5 text-[#EAB308]" />
                  <span>Слой 2 · Роль («кто он?») — силуэт тела</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {ROLE_OPTIONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      data-testid={`role-btn-${r.id}`}
                      onClick={() =>
                        setSpec((prev) => ({
                          ...prev,
                          role: r.id,
                          isZombie: r.id === 'zombie' ? true : false,
                          ageStage: r.id === 'child' ? 'child' : prev.ageStage === 'child' ? 'adult' : prev.ageStage,
                        }))
                      }
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors cursor-pointer ${
                        layersInfo.effectiveRole === r.id
                          ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD] hover:border-[#4A4A54]'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F4F2ED]">
                    Слой 3 · Личность (голова по ID)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="preset-alliance-monarch-btn"
                      onClick={() => {
                        setSpec((prev) => ({
                          ...prev,
                          role: 'monarch',
                          isZombie: false,
                          ageStage: 'adult',
                          headVariant: (prev.headVariant + 1) % 3,
                          alliedKingdomColorIdx:
                            prev.alliedKingdomColorIdx !== undefined
                              ? (prev.alliedKingdomColorIdx + 3) % 88
                              : (prev.kingdomColorIdx + 1) % 88,
                        }));
                      }}
                      className="inline-flex items-center gap-1 rounded border border-[#EAB308]/50 bg-[#EAB308]/15 px-2 py-0.5 text-[11px] font-medium text-[#EAB308] hover:bg-[#EAB308]/25 cursor-pointer"
                    >
                      <Crown className="h-3 w-3" />
                      <span>Лидер Альянса</span>
                    </button>
                    <button
                      type="button"
                      data-testid="random-human-id-btn"
                      onClick={() => {
                        const nextId = Math.floor(Math.random() * 9000) + 100;
                        setSpec(createHumanFromId(nextId));
                      }}
                      className="inline-flex items-center gap-1 rounded border border-[#2C2C34] bg-[#18181D] px-2 py-0.5 text-[11px] text-[#EAB308] hover:border-[#EAB308] cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Случайный</span>
                    </button>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1">
                  {Array.from({ length: 11 }, (_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      data-testid={`head-btn-${idx}`}
                      onClick={() => setSpec((prev) => ({ ...prev, headVariant: idx }))}
                      className={`h-7 w-7 rounded font-mono text-xs cursor-pointer ${
                        spec.headVariant % 11 === idx
                          ? 'bg-[#A78BFA] font-bold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD] hover:border-[#4A4A54]'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Layer 4: 88 Kingdom Colors (+ Allied Kingdom K2 for Alliance Monarch) */}
            <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[#F4F2ED]">
                  <Shield className="h-3.5 w-3.5 text-[#38BDF8]" />
                  <span>Слой 4 · Государство — палитра из 88 цветов королевств</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="kingdom-slot-primary"
                    onClick={() => setKingdomSlot('primary')}
                    className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${
                      kingdomSlot === 'primary'
                        ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#A1A1AA]'
                    }`}
                  >
                    Держава K1 (#{spec.kingdomColorIdx + 1})
                  </button>
                  <button
                    type="button"
                    data-testid="kingdom-slot-allied"
                    onClick={() => {
                      setKingdomSlot('allied');
                      if (spec.alliedKingdomColorIdx === undefined) {
                        setSpec((prev) => ({
                          ...prev,
                          alliedKingdomColorIdx: (prev.kingdomColorIdx + 1) % 88,
                        }));
                      }
                    }}
                    className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${
                      kingdomSlot === 'allied'
                        ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#A1A1AA]'
                    }`}
                  >
                    Союзник Альянса K2 (
                    {layersInfo.alliedKingdomColor ? `#${layersInfo.alliedKingdomColor.id + 1}` : 'авто'})
                  </button>
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-[repeat(11,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(22,minmax(0,1fr))]">
                {HUMAN_KINGDOM_COLORS_88.map((kc) => {
                  const isPrimary = spec.kingdomColorIdx === kc.id;
                  const isAllied = layersInfo.alliedKingdomColor?.id === kc.id;
                  return (
                    <button
                      key={kc.id}
                      type="button"
                      title={kc.name}
                      aria-label={kc.name}
                      data-testid={`kingdom-88-${kc.id}`}
                      onClick={() =>
                        setSpec((prev) =>
                          kingdomSlot === 'allied'
                            ? { ...prev, alliedKingdomColorIdx: kc.id }
                            : { ...prev, kingdomColorIdx: kc.id }
                        )
                      }
                      className={`h-4 w-full rounded-xs cursor-pointer transition-transform ${
                        isPrimary
                          ? 'scale-125 ring-2 ring-[#F4F2ED] z-10'
                          : isAllied
                            ? 'scale-125 ring-2 ring-[#EAB308] z-10'
                            : 'opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: kc.primaryHex }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Layer 5: 52 Skin Tones × 4 Shades */}
            <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[#F4F2ED]">
                  <Dna className="h-3.5 w-3.5 text-[#34D399]" />
                  <span>Слой 5 · Происхождение — 52 цвета кожи × 4 оттенка</span>
                </span>
                <div className="flex items-center gap-1">
                  {([0, 1, 2, 3] as const).map((sh) => (
                    <button
                      key={sh}
                      type="button"
                      onClick={() => setSpec((prev) => ({ ...prev, skinShade: sh }))}
                      className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${
                        spec.skinShade === sh
                          ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#A1A1AA]'
                      }`}
                    >
                      Отт. {sh + 1}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(26,minmax(0,1fr))]">
                {HUMAN_SKIN_COLORS_52.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    title={sc.name}
                    aria-label={sc.name}
                    data-testid={`skin-52-${sc.id}`}
                    onClick={() => setSpec((prev) => ({ ...prev, skinColorIdx: sc.id }))}
                    className={`h-4 w-full rounded-xs cursor-pointer transition-transform ${
                      spec.skinColorIdx === sc.id
                        ? 'scale-125 ring-2 ring-[#EAB308] z-10'
                        : 'opacity-90 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: sc.fromHex }}
                  />
                ))}
              </div>
            </div>

            {/* Layer 6: Age Stage, Zombie & Visual Mutations */}
            <div className="rounded-xl border border-[#24242A] bg-[#121216] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-[#F4F2ED] mr-1">
                    Слой 6 · Возраст и состояние:
                  </span>
                  {AGE_OPTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      data-testid={`age-btn-${a.id}`}
                      onClick={() =>
                        setSpec((prev) => ({
                          ...prev,
                          ageStage: a.id,
                          isZombie: false,
                          role: prev.role === 'child' && a.id !== 'child' ? 'man' : prev.role === 'zombie' ? 'man' : prev.role,
                        }))
                      }
                      className={`rounded-lg px-2.5 py-1 text-[11px] cursor-pointer ${
                        !spec.isZombie && spec.ageStage === a.id
                          ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid="toggle-zombie-btn"
                    onClick={() =>
                      setSpec((prev) => ({
                        ...prev,
                        isZombie: !prev.isZombie,
                      }))
                    }
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] cursor-pointer ${
                      spec.isZombie
                        ? 'bg-[#22C55E] font-semibold text-[#0B0B0D]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                    }`}
                  >
                    <Skull className="h-3 w-3" />
                    <span>Зомби</span>
                  </button>
                  <button
                    type="button"
                    data-testid="toggle-festive-btn"
                    onClick={() =>
                      setSpec((prev) => ({
                        ...prev,
                        isFestive: !prev.isFestive,
                      }))
                    }
                    className={`rounded-lg px-2.5 py-1 text-[11px] cursor-pointer ${
                      spec.isFestive
                        ? 'bg-[#EF4444] font-semibold text-[#F4F2ED]'
                        : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                    }`}
                  >
                    Шапка (7+7)
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-[#A78BFA] mr-1" />
                  {MUTATION_OPTIONS.map((mut) => (
                    <button
                      key={mut.id}
                      type="button"
                      data-testid={`mutation-btn-${mut.id}`}
                      onClick={() => setSpec((prev) => ({ ...prev, mutation: mut.id }))}
                      className={`rounded-md px-2 py-1 text-[11px] cursor-pointer ${
                        spec.mutation === mut.id
                          ? 'bg-[#A78BFA] font-semibold text-[#0B0B0D]'
                          : 'border border-[#24242B] bg-[#17171C] text-[#A1A1AA]'
                      }`}
                    >
                      {mut.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM ROW: Family Inheritance Lab + Top-Down 24-Citizen Crowd Diorama */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Family Inheritance & Lifecycle Aging */}
          <div className="rounded-2xl border border-[#24242A] bg-[#121216] p-5 lg:col-span-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-[#F4F2ED]">
                <Baby className="h-4 w-4 text-[#34D399]" />
                <span>Семья: наследование кожи и старение</span>
              </h3>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-[#A1A1AA]">
              Ребёнок наследует цвет кожи одного из родителей (Слой 5), а личная голова (Слой 3) сохраняется
              на всю жизнь до самой седины (Слой 6).
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center rounded-xl border border-[#24242B] bg-[#16161B] p-3">
                <span className="text-[11px] text-[#8E8E98]">Отец (Кожа #{parentA.skinColorIdx + 1})</span>
                <div className="my-2">
                  <HumanSpriteCanvas spec={parentA} scale={5} frame={frame} showShadow stageBg="meadow" />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setParentA((p) => ({ ...p, skinColorIdx: (p.skinColorIdx + 7) % 52 }))
                  }
                  className="rounded border border-[#2C2C34] bg-[#1D1D23] px-2 py-1 text-[10px] text-[#D4D2CD] hover:border-[#EAB308] cursor-pointer"
                >
                  Сменить кожу
                </button>
              </div>

              <div className="flex flex-col items-center rounded-xl border border-[#24242B] bg-[#16161B] p-3">
                <span className="text-[11px] text-[#8E8E98]">Мать (Кожа #{parentB.skinColorIdx + 1})</span>
                <div className="my-2">
                  <HumanSpriteCanvas spec={parentB} scale={5} frame={frame} showShadow stageBg="meadow" />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setParentB((p) => ({ ...p, skinColorIdx: (p.skinColorIdx + 11) % 52 }))
                  }
                  className="rounded border border-[#2C2C34] bg-[#1D1D23] px-2 py-1 text-[10px] text-[#D4D2CD] hover:border-[#EAB308] cursor-pointer"
                >
                  Сменить кожу
                </button>
              </div>

              <div
                data-testid="family-child-card"
                className="flex flex-col items-center rounded-xl border border-[#34D399]/40 bg-[#34D399]/10 p-3"
              >
                <span className="text-[11px] font-medium text-[#34D399]">
                  Ребёнок #{familyChild.personalId}
                </span>
                <div className="my-2">
                  <HumanSpriteCanvas spec={familyChild} scale={5} frame={frame} showShadow stageBg="meadow" />
                </div>
                <span className="text-center text-[10px] text-[#D4D2CD]">
                  Кожа #{familyChild.skinColorIdx + 1} ({childInheritedFrom})
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="spawn-child-btn"
                onClick={handleSpawnChild}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#34D399] px-3 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-[#4ADE80] cursor-pointer"
              >
                <Baby className="h-3.5 w-3.5" />
                <span>Родить ребёнка</span>
              </button>
              <button
                type="button"
                data-testid="age-child-btn"
                onClick={handleCycleChildLife}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#2E2E36] bg-[#18181D] px-3 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] cursor-pointer"
              >
                <span>
                  Возраст: {familyChild.isZombie ? 'Зомби → Сброс' : familyChild.ageStage === 'child' ? 'Ребёнок → Взрослый' : familyChild.ageStage === 'adult' ? 'Взрослый → Старик' : 'Старик → Зомби'}
                </span>
              </button>
            </div>
          </div>

          {/* Live Top-Down Crowd Sandbox */}
          <div className="rounded-2xl border border-[#24242A] bg-[#121216] p-5 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-[#F4F2ED]">
                <Users className="h-4 w-4 text-[#EAB308]" />
                <span>Взгляд сверху: 24 жителя 10×10 в движении</span>
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="scenario-two-cultures"
                  onClick={() => handleSelectScenario('two-cultures-same-kingdom')}
                  className={`rounded-md px-2.5 py-1 text-[11px] cursor-pointer ${
                    crowdScenario === 'two-cultures-same-kingdom'
                      ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                      : 'border border-[#26262D] bg-[#18181D] text-[#A1A1AA]'
                  }`}
                >
                  2 народа · 1 королевство
                </button>
                <button
                  type="button"
                  data-testid="scenario-two-kingdoms"
                  onClick={() => handleSelectScenario('one-culture-two-kingdoms')}
                  className={`rounded-md px-2.5 py-1 text-[11px] cursor-pointer ${
                    crowdScenario === 'one-culture-two-kingdoms'
                      ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                      : 'border border-[#26262D] bg-[#18181D] text-[#A1A1AA]'
                  }`}
                >
                  1 народ · 2 державы
                </button>
                <button
                  type="button"
                  data-testid="crowd-outbreak-btn"
                  onClick={() => handleToggleOutbreak(true)}
                  className="rounded-md border border-[#22C55E]/40 bg-[#22C55E]/15 px-2.5 py-1 text-[11px] text-[#86EFAC] hover:bg-[#22C55E]/25 cursor-pointer"
                >
                  Заразить (Зомби)
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleOutbreak(false)}
                  className="rounded-md border border-[#26262D] bg-[#18181D] px-2.5 py-1 text-[11px] text-[#D4D2CD] hover:border-[#4A4A54] cursor-pointer"
                >
                  Исцелить
                </button>
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-[#26262C]">
              <canvas
                ref={crowdCanvasRef}
                data-testid="human-crowd-canvas"
                width={CROWD_W * CROWD_SCALE}
                height={CROWD_H * CROWD_SCALE}
                onClick={handleCrowdClick}
                className="block w-full aspect-[240/112] pixelated-canvas cursor-pointer"
              />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8E8E98]">
              <p>
                Нажмите на любую фигурку в толпе сверху, чтобы загрузить её точные 6 слоёв в инспектор слева. Видно без текста: корону короля, шлемы воинов, юбки, детей, седину стариков, цвета держав и костюмы народов.
              </p>
              {selectedCrowdId !== null && (
                <span
                  data-testid="selected-crowd-badge"
                  className="rounded border border-[#EAB308]/40 bg-[#EAB308]/10 px-2 py-0.5 font-mono text-[11px] text-[#EAB308]"
                >
                  Выбран житель #{selectedCrowdId}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
