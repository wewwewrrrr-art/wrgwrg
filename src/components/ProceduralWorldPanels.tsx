import { Archive, Building2, Castle, Check, Code2, Copy, Dices, Download, FileJson, PawPrint } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GENE_APPENDAGE_OPTIONS,
  GENE_BIOME_OPTIONS,
  GENE_COAT_OPTIONS,
  GENE_PATTERN_OPTIONS,
  GENE_SIZE_OPTIONS,
} from '../engine/genes';
import { triggerFullExportZipDownload } from '../engine/forgeApi';
import { PixelBuffer } from '../engine/pixelCanvas';
import {
  FLAGSHIP_SIX_KINGDOMS,
  SHOWCASE_ANIMAL_IDS,
  drawPackedBatchToCanvas,
  generateAnimalPhenotypeVariant,
  generateBuildingSixKingdomVariants,
  getAllMedievalAndBronzeBuildings,
  packProceduralAtlasBatch,
  triggerJsonDownload,
  triggerPackedBatchPngDownload,
} from '../engine/proceduralBuildingsAndAnimals';
import { MEDIEVAL_TOWN_HALL, RACE_ARCHITECTURE_GROUPS } from '../engine/proceduralRaceBuildings';
import { ALL_MODELS, BUILDING_STATE_OPTIONS, getModelEra } from '../models';
import {
  BuildingState,
  GeneAppendages,
  GeneBiomeTint,
  GeneCoat,
  GenePattern,
  GeneSize,
  PixelModelDef,
} from '../models/types';
import { downloadModelCodeTs } from '../utils/exportModelCode';
import { ProceduralPhenotypeShowcase } from './ProceduralPhenotypeShowcase';

function drawArbitraryBuffer(
  canvas: HTMLCanvasElement | null,
  buf: PixelBuffer,
  scale: number
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
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function ScaledBufferCanvas({
  buffer,
  scale,
  ariaLabel,
  testId,
  exactSize = false,
}: {
  buffer: PixelBuffer;
  scale: number;
  ariaLabel?: string;
  testId?: string;
  exactSize?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    drawArbitraryBuffer(ref.current, buffer, scale);
  }, [buffer, scale]);

  return (
    <canvas
      ref={ref}
      data-testid={testId}
      aria-label={ariaLabel}
      width={buffer.width * scale}
      height={buffer.height * scale}
      className={`pixelated-canvas block ${exactSize ? 'shrink-0' : 'max-w-full h-auto'}`}
    />
  );
}

interface ProceduralWorldPanelsProps {
  onInspectModel?: (model: PixelModelDef, initialTab?: 'preview' | 'code') => void;
}

export function ProceduralWorldPanels({ onInspectModel }: ProceduralWorldPanelsProps = {}) {
  const modelsById = useMemo(
    () => new Map<string, PixelModelDef>(ALL_MODELS.map((m) => [m.id, m])),
    []
  );

  // --- PART 4A: ALL 27 MEDIEVAL & BRONZE BUILDINGS (26 CATALOG + TOWN HALL) × 6 KINGDOMS ---
  const allMedBronzeBuildings = useMemo(
    () => [...getAllMedievalAndBronzeBuildings(ALL_MODELS), MEDIEVAL_TOWN_HALL],
    []
  );
  const [buildingEraTab, setBuildingEraTab] = useState<'all' | 'medieval' | 'bronze-iron'>('all');
  const [buildingState, setBuildingState] = useState<BuildingState>('ready');
  const [buildingScaleMode, setBuildingScaleMode] = useState<'auto' | 2 | 4>('auto');
  const [expandBuildingsMatrix, setExpandBuildingsMatrix] = useState<boolean>(false);

  const visibleBuildings = useMemo(() => {
    if (buildingEraTab === 'all') return allMedBronzeBuildings;
    return allMedBronzeBuildings.filter((m) => getModelEra(m) === buildingEraTab);
  }, [allMedBronzeBuildings, buildingEraTab]);

  const allBuildingsMatrix = useMemo(() => {
    return visibleBuildings.map((model) => ({
      model,
      era: getModelEra(model),
      variants: generateBuildingSixKingdomVariants(
        model,
        buildingState,
        FLAGSHIP_SIX_KINGDOMS,
        'dark',
        0
      ),
    }));
  }, [visibleBuildings, buildingState]);

  // --- PART 4B: ORIGINAL & PREHISTORIC RACE ARCHITECTURE (3 BUILDINGS × 8 RACES) ---
  const [raceBuildingKingdomIdx, setRaceBuildingKingdomIdx] = useState<number>(0);
  const [raceBuildingState, setRaceBuildingState] = useState<BuildingState>('ready');
  const [raceBuildingScale, setRaceBuildingScale] = useState<2 | 3 | 4>(3);

  const raceArchitectureRendered = useMemo(() => {
    const k = FLAGSHIP_SIX_KINGDOMS[raceBuildingKingdomIdx] ?? FLAGSHIP_SIX_KINGDOMS[0];
    return RACE_ARCHITECTURE_GROUPS.map((group) => ({
      ...group,
      items: group.buildings.map((b) => ({
        model: b,
        variant: generateBuildingSixKingdomVariants(b, raceBuildingState, [k], 'dark', 0)[0],
      })),
    }));
  }, [raceBuildingKingdomIdx, raceBuildingState]);

  // --- PART 5: INTERACTIVE ANIMAL PHENOTYPES + 5×12 & ALL-205 TABLE ---
  const animalModels = useMemo(
    () =>
      SHOWCASE_ANIMAL_IDS.map((id) => modelsById.get(id)).filter(
        (m): m is PixelModelDef => Boolean(m)
      ),
    [modelsById]
  );
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>('dire-wolf');
  const [animalCoat, setAnimalCoat] = useState<GeneCoat>('natural');
  const [animalPattern, setAnimalPattern] = useState<GenePattern>('solid');
  const [animalBiome, setAnimalBiome] = useState<GeneBiomeTint>('none');
  const [animalSize, setAnimalSize] = useState<GeneSize>('standard');
  const [animalAppendages, setAnimalAppendages] = useState<GeneAppendages>('standard');
  const [animalKingdomIdx, setAnimalKingdomIdx] = useState<number>(0);

  const selectedAnimalModel = modelsById.get(selectedAnimalId) ?? animalModels[0];

  const mainAnimalVariant = useMemo(() => {
    if (!selectedAnimalModel) return null;
    return generateAnimalPhenotypeVariant(selectedAnimalModel, 404, {
      genes: {
        coat: animalCoat,
        pattern: animalPattern,
        biomeTint: animalBiome,
        size: animalSize,
        appendages: animalAppendages,
      },
      kingdomId: animalKingdomIdx,
    });
  }, [
    selectedAnimalModel,
    animalCoat,
    animalPattern,
    animalBiome,
    animalSize,
    animalAppendages,
    animalKingdomIdx,
  ]);

  const animalPhenotypeStrip = useMemo(() => {
    if (!selectedAnimalModel) return [];
    const presets: {
      label: string;
      coat: GeneCoat;
      pattern: GenePattern;
      biomeTint: GeneBiomeTint;
      size: GeneSize;
      appendages: GeneAppendages;
      kIdx: number;
    }[] = [
      { label: 'Природный · Ровный', coat: 'natural', pattern: 'solid', biomeTint: 'none', size: 'standard', appendages: 'standard', kIdx: 0 },
      { label: 'Меланист · Крап', coat: 'dark', pattern: 'dappled', biomeTint: 'forest', size: 'colossal', appendages: 'ornate', kIdx: 1 },
      { label: 'Альбинос · Пятна', coat: 'albino', pattern: 'spotted', biomeTint: 'tundra', size: 'standard', appendages: 'standard', kIdx: 2 },
      { label: 'Тигровый · Вулкан', coat: 'striped', pattern: 'striped', biomeTint: 'volcanic', size: 'compact', appendages: 'none', kIdx: 3 },
    ];
    return presets.map((p) => ({
      label: p.label,
      result: generateAnimalPhenotypeVariant(selectedAnimalModel, 505, {
        genes: { coat: p.coat, pattern: p.pattern, biomeTint: p.biomeTint, size: p.size, appendages: p.appendages },
        kingdomId: p.kIdx,
      }),
    }));
  }, [selectedAnimalModel]);

  const handleRandomAnimalPhenotype = () => {
    const coats: readonly GeneCoat[] = ['natural', 'dark', 'albino', 'striped'];
    const patterns: readonly GenePattern[] = ['solid', 'striped', 'spotted', 'dappled'];
    const biomes: readonly GeneBiomeTint[] = ['none', 'forest', 'tundra', 'desert', 'volcanic'];
    const sizes: readonly GeneSize[] = ['compact', 'standard', 'colossal'];
    const apps: readonly GeneAppendages[] = ['none', 'standard', 'ornate'];
    setAnimalCoat(coats[Math.floor(Math.random() * coats.length)]);
    setAnimalPattern(patterns[Math.floor(Math.random() * patterns.length)]);
    setAnimalBiome(biomes[Math.floor(Math.random() * biomes.length)]);
    setAnimalSize(sizes[Math.floor(Math.random() * sizes.length)]);
    setAnimalAppendages(apps[Math.floor(Math.random() * apps.length)]);
    setAnimalKingdomIdx(Math.floor(Math.random() * 6));
  };

  // --- PART 6: UNIFIED ATLAS & JSON MANIFEST EXPORT ---
  const [atlasCount, setAtlasCount] = useState<48 | 144 | 300>(144);
  const [atlasSeed, setAtlasSeed] = useState<number>(8000);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [fullExportInfo, setFullExportInfo] = useState<string | null>(null);
  const sheetCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const packedAtlas = useMemo(
    () =>
      packProceduralAtlasBatch({
        count: atlasCount,
        baseSeed: atlasSeed,
        includeAllEras: true,
        includeAllRaces: true,
      }),
    [atlasCount, atlasSeed]
  );

  useEffect(() => {
    if (!sheetCanvasRef.current) return;
    drawPackedBatchToCanvas(sheetCanvasRef.current, packedAtlas.units.slice(0, 72), 3, 12);
  }, [packedAtlas]);

  const jsonPreviewSnippet = useMemo(
    () => packedAtlas.jsonString.split('\n').slice(0, 42).join('\n'),
    [packedAtlas.jsonString]
  );

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(packedAtlas.jsonString);
      setCopiedJson(true);
      window.setTimeout(() => setCopiedJson(false), 1800);
    } catch {
      // Ignore clipboard failures in restricted headless environments
    }
  };

  return (
    <div className="mt-8 space-y-8">
      {/* PART 4A: ALL 27 MEDIEVAL & BRONZE BUILDINGS × 6 KINGDOMS */}
      <div
        data-testid="proc-buildings-six-kingdoms"
        className="rounded-xl border border-[#26262B] bg-[#121216] p-5"
      >
        <div className="flex flex-col gap-3 border-b border-[#222228] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#EAB308]">
              <Building2 className="h-3.5 w-3.5" />
              <span>Постройки держав · Все {allMedBronzeBuildings.length} зданий Средневековья и Бронзы</span>
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F2ED]">
              Полная матрица: все {allMedBronzeBuildings.length} построек (Средневековье 17 + Бронза 10) × 6 королевств
            </h3>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              Казарма, замок, ратуша, храм, рынок, стены, ворота и кузни перекрашиваются по зонам <code>K1/K2</code> во всех 6 флагманских королевствах и 4 состояниях.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {BUILDING_STATE_OPTIONS.map((st) => (
              <button
                key={st.id}
                type="button"
                data-testid={`proc-bstate-${st.id}`}
                onClick={() => setBuildingState(st.id)}
                className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                  buildingState === st.id
                    ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                    : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Era Tabs + Scale & Expand Controls */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'all', label: `Все ${allMedBronzeBuildings.length} построек` },
                { id: 'medieval', label: 'Средневековье (17)' },
                { id: 'bronze-iron', label: 'Бронза и железо (10)' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`proc-b26-tab-${t.id}`}
                onClick={() => setBuildingEraTab(t.id)}
                className={`rounded px-3 py-1 text-xs cursor-pointer ${
                  buildingEraTab === t.id
                    ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                    : 'border border-[#24242B] bg-[#17171C] text-[#D4D2CD]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded border border-[#26262E] bg-[#18181E] p-0.5 text-[11px]">
              {(['auto', 2, 4] as const).map((sc) => (
                <button
                  key={String(sc)}
                  type="button"
                  data-testid={`proc-bscale-${sc}`}
                  onClick={() => setBuildingScaleMode(sc)}
                  className={`rounded px-2 py-0.5 cursor-pointer ${
                    buildingScaleMode === sc
                      ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                      : 'text-[#C4C2BD]'
                  }`}
                >
                  {sc === 'auto' ? 'Авто' : `${sc}×`}
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="proc-b-expand-btn"
              onClick={() => setExpandBuildingsMatrix((v) => !v)}
              className="rounded border border-[#2C2C34] bg-[#18181D] px-2.5 py-1 text-[11px] text-[#D4D2CD] hover:border-[#38BDF8] cursor-pointer"
            >
              {expandBuildingsMatrix ? 'Компактный список' : 'Развернуть все строки'}
            </button>
            <span className="font-mono text-[11px] text-[#34D399] tabular-nums">
              {allBuildingsMatrix.length} × 6 = {allBuildingsMatrix.length * 6}
            </span>
          </div>
        </div>

        {/* 6 Kingdom Header Bar */}
        <div className="mt-4 hidden grid-cols-7 gap-2 px-2 text-[11px] font-medium text-[#8E8E98] lg:grid">
          <div>Постройка</div>
          {FLAGSHIP_SIX_KINGDOMS.map((k) => (
            <div key={k.id} className="flex items-center justify-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: k.primaryHex }} />
              <span className="truncate text-[#D4D2CD]">{k.name}</span>
            </div>
          ))}
        </div>

        {/* Full 27-Row × 6-Kingdom Matrix */}
        <div
          className={`mt-2 space-y-2 pr-1 ${
            expandBuildingsMatrix ? 'overflow-x-auto' : 'max-h-[560px] overflow-auto'
          }`}
        >
          {allBuildingsMatrix.map((row) => {
            const scale =
              buildingScaleMode === 'auto'
                ? row.model.width > 42
                  ? 1
                  : 2
                : buildingScaleMode;
            const exact = buildingScaleMode === 4;
            return (
              <div
                key={row.model.id}
                data-testid={`proc-b26-row-${row.model.id}`}
                className={`rounded-lg border border-[#22222A] bg-[#16161B] p-2.5 ${
                  exact
                    ? 'flex flex-col gap-2 min-w-max'
                    : 'grid grid-cols-1 gap-2 lg:grid-cols-7 lg:items-center'
                }`}
              >
                <div className="pr-2">
                  <div className="text-xs font-semibold text-[#F4F2ED]">{row.model.name}</div>
                  <div className="font-mono text-[10px] text-[#8E8E98]">
                    {row.era === 'medieval' ? 'Средневековье' : 'Бронза'} · {row.model.width}×{row.model.height} · {scale}×
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {onInspectModel && (
                      <button
                        type="button"
                        data-testid={`b26-code-${row.model.id}`}
                        aria-label={`Открыть код постройки ${row.model.name}`}
                        onClick={() => onInspectModel(row.model, 'code')}
                        className="inline-flex items-center gap-1 rounded border border-[#2C2C34] bg-[#1C1C23] px-1.5 py-0.5 text-[10px] text-[#D4D2CD] hover:border-[#EAB308] hover:text-[#F4F2ED] cursor-pointer"
                      >
                        <Code2 className="h-2.5 w-2.5 text-[#EAB308]" />
                        <span>Код</span>
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`b26-dl-${row.model.id}`}
                      aria-label={`Скачать TypeScript-код постройки ${row.model.name}`}
                      onClick={() =>
                        downloadModelCodeTs(row.model, {
                          kingdomId: 'original',
                          buildingState,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#2C2C34] bg-[#1C1C23] px-1.5 py-0.5 text-[10px] text-[#EAB308] hover:border-[#EAB308] hover:bg-[#EAB308]/10 cursor-pointer"
                    >
                      <Download className="h-2.5 w-2.5" />
                      <span>.ts</span>
                    </button>
                  </div>
                </div>
                <div className={exact ? 'flex gap-2' : 'grid grid-cols-3 gap-2 sm:grid-cols-6 lg:col-span-6'}>
                  {row.variants.map((v) => (
                    <div
                      key={`${row.model.id}-${v.kingdom.id}`}
                      className="flex flex-col items-center justify-between rounded border border-[#242C26] bg-[#243627] p-1.5"
                      title={`${row.model.name} — ${v.kingdom.name} (K1: ${v.k1ChangedPixels}px)`}
                    >
                      <div className="flex min-h-[68px] items-center justify-center">
                        <ScaledBufferCanvas
                          buffer={v.buffer}
                          scale={scale}
                          exactSize={exact}
                          ariaLabel={`${row.model.name} — ${v.kingdom.name}`}
                        />
                      </div>
                      <span className="mt-1 font-mono text-[9px] text-[#D4D2CD]/80">
                        K1:{v.k1ChangedPixels} · INK:{v.inkPixels}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PART 4B: RACE ARCHITECTURE (8 RACES × 3 BUILDINGS EACH = 24 UNIQUE STRUCTURES) */}
      <div
        data-testid="proc-race-architecture"
        className="rounded-xl border border-[#26262B] bg-[#121216] p-5"
      >
        <div className="flex flex-col gap-3 border-b border-[#222228] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#F472B6]">
              <Castle className="h-3.5 w-3.5" />
              <span>Уникальная архитектура рас · 8 рас × 3 постройки = 24 здания</span>
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F2ED]">
              Постройки оригинальных рас, Нежити, Демонов, Неандертальцев и Рапторов ({raceBuildingScale}×)
            </h3>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              У каждой разумной расы — собственные 3 постройки (или гнёзда у ящеров-рапторов) с перекраской масок державы <code>K1/K2</code> и 4 состояниями.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded border border-[#26262E] bg-[#18181E] p-0.5 text-[11px]">
              {([2, 3, 4] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setRaceBuildingScale(sc)}
                  className={`rounded px-2 py-0.5 cursor-pointer ${
                    raceBuildingScale === sc
                      ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                      : 'text-[#C4C2BD]'
                  }`}
                >
                  {sc}×
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded border border-[#26262E] bg-[#18181E] p-1">
              {FLAGSHIP_SIX_KINGDOMS.map((k, idx) => (
                <button
                  key={k.id}
                  type="button"
                  title={k.name}
                  onClick={() => setRaceBuildingKingdomIdx(idx)}
                  className={`h-5 w-6 rounded-xs cursor-pointer ${
                    raceBuildingKingdomIdx === idx ? 'ring-2 ring-[#F4F2ED] scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: k.primaryHex }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {BUILDING_STATE_OPTIONS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setRaceBuildingState(st.id)}
                  className={`rounded px-2 py-1 text-[10.5px] cursor-pointer ${
                    raceBuildingState === st.id
                      ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                      : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {raceArchitectureRendered.map((group) => (
            <div
              key={group.raceId}
              data-testid={`proc-race-arch-${group.raceId}`}
              className="rounded-lg border border-[#24242B] bg-[#16161B] p-3.5"
            >
              <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-[#F4F2ED]">{group.raceLabel}</h4>
                  <p className="text-[11px] text-[#8E8E98]">{group.subtitle}</p>
                </div>
                <span className="font-mono text-[10px] text-[#34D399]">3 постройки · {raceBuildingScale}×</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {group.items.map(({ model, variant }) => {
                  const activeKingdom =
                    FLAGSHIP_SIX_KINGDOMS[raceBuildingKingdomIdx] ?? FLAGSHIP_SIX_KINGDOMS[0];
                  return (
                    <div
                      key={model.id}
                      className="flex flex-col items-center rounded border border-[#25252D] bg-[#1A1A21] p-2"
                    >
                      <button
                        type="button"
                        onClick={() => onInspectModel?.(model, 'preview')}
                        aria-label={`Открыть инспектор постройки ${model.name}`}
                        className="flex min-h-[120px] w-full items-center justify-center overflow-x-auto rounded bg-[#243627] p-1.5 cursor-pointer hover:ring-1 hover:ring-[#F472B6]/60 transition-shadow focus-visible:outline-2 focus-visible:outline-[#EAB308]"
                      >
                        <ScaledBufferCanvas
                          buffer={variant.buffer}
                          scale={raceBuildingScale}
                          exactSize={raceBuildingScale >= 3}
                          ariaLabel={`${group.raceLabel}: ${model.name}`}
                        />
                      </button>
                      <span className="mt-1.5 w-full truncate text-center text-[11px] font-medium text-[#F4F2ED]">
                        {model.name}
                      </span>
                      <span className="font-mono text-[9px] text-[#8E8E98]">
                        K1:{variant.k1ChangedPixels} · INK:{variant.inkPixels}
                      </span>
                      <div className="mt-1.5 flex w-full items-center justify-center gap-1 border-t border-[#24242C] pt-1.5">
                        {onInspectModel && (
                          <button
                            type="button"
                            data-testid={`race-building-code-${model.id}`}
                            aria-label={`Открыть код постройки ${model.name}`}
                            onClick={() => onInspectModel(model, 'code')}
                            className="inline-flex items-center gap-1 rounded border border-[#2C2C34] bg-[#14141A] px-2 py-0.5 text-[10px] text-[#D4D2CD] hover:border-[#EAB308] hover:text-[#F4F2ED] cursor-pointer"
                          >
                            <Code2 className="h-2.5 w-2.5 text-[#EAB308]" />
                            <span>Код</span>
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid={`race-building-dl-${model.id}`}
                          aria-label={`Скачать код постройки ${model.name} (.ts)`}
                          onClick={() =>
                            downloadModelCodeTs(model, {
                              kingdomId: String(activeKingdom.id),
                              buildingState: raceBuildingState,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded border border-[#2C2C34] bg-[#14141A] px-2 py-0.5 text-[10px] text-[#EAB308] hover:border-[#EAB308] hover:bg-[#EAB308]/10 cursor-pointer"
                        >
                          <Download className="h-2.5 w-2.5" />
                          <span>Скачать .ts</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PART 5A: INTERACTIVE ANIMAL PHENOTYPES & GENETIC MUTATIONS */}
      <div
        data-testid="proc-animal-phenotypes"
        className="rounded-xl border border-[#26262B] bg-[#121216] p-5"
      >
        <div className="flex flex-col gap-3 border-b border-[#222228] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#34D399]">
              <PawPrint className="h-3.5 w-3.5" />
              <span>Животные и фенотипы · Лаборатория генов (CreatureGenes)</span>
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F2ED]">
              Окрас, узор (полосы / пятна / крап), адаптация к биому и размер
            </h3>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              Мутации сохраняют направление света (-1, -1), 0 чёрной обводки и не затрагивают сбрую державы (K1/K2).
            </p>
          </div>
          <button
            type="button"
            data-testid="proc-random-animal-btn"
            onClick={handleRandomAnimalPhenotype}
            className="inline-flex items-center gap-1.5 rounded bg-[#EAB308] px-3 py-1.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] cursor-pointer whitespace-nowrap"
          >
            <Dices className="h-3.5 w-3.5" />
            <span>Случайный фенотип</span>
          </button>
        </div>

        {/* Species Tabs */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {animalModels.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`proc-animal-${m.id}`}
              onClick={() => setSelectedAnimalId(m.id)}
              className={`rounded px-2.5 py-1 text-xs cursor-pointer ${
                selectedAnimalId === m.id
                  ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                  : 'border border-[#24242B] bg-[#17171C] text-[#D4D2CD] hover:border-[#3A3A44]'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Interactive Animal Preview & Controls */}
          <div className="flex flex-col gap-3 rounded-lg border border-[#24242B] bg-[#16161B] p-4 lg:col-span-5">
            <div className="flex min-h-[150px] items-center justify-center rounded border border-[#2A3B2D] bg-[#243627] p-4">
              {mainAnimalVariant && (
                <ScaledBufferCanvas
                  buffer={mainAnimalVariant.buffer}
                  scale={selectedAnimalModel.width > 45 ? 2 : 3}
                  testId="proc-animal-preview-canvas"
                  ariaLabel={`${selectedAnimalModel.name} (${animalCoat}, ${animalPattern}, ${animalBiome})`}
                />
              )}
            </div>
            {mainAnimalVariant && (
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#A1A1AA] tabular-nums">
                <span>Пиксели: {mainAnimalVariant.opaquePixels}</span>
                <span>Цветов: {mainAnimalVariant.uniqueColors}</span>
                <span className="text-[#34D399]">INK: {mainAnimalVariant.inkPixels}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5 text-[11px]">
              <div>
                <div className="mb-1 text-[#8E8E98]">Окрас шкуры</div>
                <div className="flex flex-wrap gap-1">
                  {GENE_COAT_OPTIONS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`proc-coat-${c.id}`}
                      onClick={() => setAnimalCoat(c.id)}
                      className={`rounded px-2 py-0.5 cursor-pointer ${
                        animalCoat === c.id
                          ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                          : 'border border-[#26262E] bg-[#1B1B21] text-[#C4C2BD]'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[#8E8E98]">Узор поверхности</div>
                <div className="flex flex-wrap gap-1">
                  {GENE_PATTERN_OPTIONS.map((pt) => (
                    <button
                      key={pt.id}
                      type="button"
                      data-testid={`proc-pattern-${pt.id}`}
                      onClick={() => setAnimalPattern(pt.id)}
                      className={`rounded px-2 py-0.5 cursor-pointer ${
                        animalPattern === pt.id
                          ? 'bg-[#F472B6] font-semibold text-[#0B0B0D]'
                          : 'border border-[#26262E] bg-[#1B1B21] text-[#C4C2BD]'
                      }`}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[#8E8E98]">Размер</div>
                <div className="flex flex-wrap gap-1">
                  {GENE_SIZE_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setAnimalSize(s.id)}
                      className={`rounded px-2 py-0.5 cursor-pointer ${
                        animalSize === s.id
                          ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                          : 'border border-[#26262E] bg-[#1B1B21] text-[#C4C2BD]'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[#8E8E98]">Биом</div>
                <div className="flex flex-wrap gap-1">
                  {GENE_BIOME_OPTIONS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setAnimalBiome(b.id)}
                      className={`rounded px-2 py-0.5 cursor-pointer ${
                        animalBiome === b.id
                          ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                          : 'border border-[#26262E] bg-[#1B1B21] text-[#C4C2BD]'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-2">
                <div className="mb-1 text-[#8E8E98]">Рога / оперение</div>
                <div className="flex flex-wrap gap-1">
                  {GENE_APPENDAGE_OPTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAnimalAppendages(a.id)}
                      className={`rounded px-2 py-0.5 cursor-pointer ${
                        animalAppendages === a.id
                          ? 'bg-[#A78BFA] font-semibold text-[#0B0B0D]'
                          : 'border border-[#26262E] bg-[#1B1B21] text-[#C4C2BD]'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 4-Variant Phenotype Matrix Comparison */}
          <div className="grid grid-cols-2 gap-3 lg:col-span-7">
            {animalPhenotypeStrip.map((item) => (
              <div
                key={item.label}
                className="flex flex-col justify-between rounded-lg border border-[#24242B] bg-[#16161B] p-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#F4F2ED]">{item.label}</span>
                  <span className="font-mono text-[10px] text-[#34D399]">
                    INK {item.result.inkPixels}
                  </span>
                </div>
                <div className="my-2 flex min-h-[104px] items-center justify-center rounded bg-[#243627] p-2">
                  <ScaledBufferCanvas
                    buffer={item.result.buffer}
                    scale={selectedAnimalModel.width > 45 ? 2 : 3}
                    ariaLabel={`${selectedAnimalModel.name}: ${item.label}`}
                  />
                </div>
                <div className="font-mono text-[10px] text-[#8E8E98] tabular-nums">
                  цветов: {item.result.uniqueColors} · пикселей: {item.result.opaquePixels}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PART 5B: 5×12 SHOWCASE & ALL-205 MODEL PHENOTYPE TABLE */}
      <ProceduralPhenotypeShowcase />

      {/* PART 6: UNIFIED ATLAS PACKING & JSON + PNG EXPORT */}
      <div
        data-testid="proc-atlas-export"
        className="rounded-xl border border-[#26262B] bg-[#121216] p-5"
      >
        <div className="flex flex-col gap-3 border-b border-[#222228] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#38BDF8]">
              <FileJson className="h-3.5 w-3.5" />
              <span>Спрайт-атлас и JSON-манифест координат</span>
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F2ED]">
              Единый экспорт атласа (PNG + метаданные якорей, 6 эпох, 10 рас и зон)
            </h3>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              Упаковка процедурной выборки по всем 6 эпохам и 10 оригинальным расам в страницы{' '}
              <code>BakedSpriteAtlas</code> с точными координатами и якорями для игрового движка.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {([48, 144, 300] as const).map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => setAtlasCount(cnt)}
                className={`rounded px-2.5 py-1 font-mono text-xs cursor-pointer ${
                  atlasCount === cnt
                    ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                    : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
                }`}
              >
                {cnt} юн.
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAtlasSeed((s) => s + 251)}
              className="rounded border border-[#2C2C34] bg-[#18181D] px-2.5 py-1 text-xs text-[#F4F2ED] hover:border-[#38BDF8] cursor-pointer"
            >
              Новый набор
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Packed Sheet Preview & Download Actions */}
          <div className="flex flex-col gap-3 lg:col-span-6">
            <div className="flex items-center justify-center rounded-lg border border-[#24242B] bg-[#243627] p-3 overflow-x-auto">
              <canvas
                ref={sheetCanvasRef}
                data-testid="proc-atlas-sheet-canvas"
                aria-label="Лист спрайт-атласа (первые 72 юнита из батча)"
                className="pixelated-canvas block"
              />
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-lg border border-[#24242B] bg-[#16161B] p-3 font-mono text-[11px] tabular-nums">
              <div>
                <div className="text-[#8E8E98]">Кадров</div>
                <div className="text-[#F4F2ED] font-semibold">{packedAtlas.manifest.summary.totalFrames}</div>
              </div>
              <div>
                <div className="text-[#8E8E98]">Макс. цветов</div>
                <div className="text-[#34D399] font-semibold">{packedAtlas.manifest.summary.maxColorsObserved} / 8</div>
              </div>
              <div>
                <div className="text-[#8E8E98]">Сирот / INK</div>
                <div className="text-[#34D399] font-semibold">{packedAtlas.manifest.summary.totalOrphanPixels} / 0</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="proc-export-png-btn"
                onClick={() =>
                  triggerPackedBatchPngDownload(
                    packedAtlas.units,
                    `kostyanaya-procedural-${atlasCount}u-4x.png`,
                    4,
                    12
                  )
                }
                className="inline-flex items-center gap-1.5 rounded bg-[#EAB308] px-3 py-1.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Скачать PNG атласа</span>
              </button>
              <button
                type="button"
                data-testid="proc-export-json-btn"
                onClick={() =>
                  triggerJsonDownload(
                    packedAtlas.jsonString,
                    `kostyanaya-procedural-${atlasCount}u-manifest.json`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded border border-[#2C2C34] bg-[#18181D] px-3 py-1.5 text-xs font-medium text-[#F4F2ED] hover:border-[#38BDF8] cursor-pointer"
              >
                <FileJson className="h-3.5 w-3.5 text-[#38BDF8]" />
                <span>Скачать JSON манифест</span>
              </button>
              <button
                type="button"
                data-testid="proc-copy-json-btn"
                onClick={handleCopyJson}
                className="inline-flex items-center gap-1.5 rounded border border-[#2C2C34] bg-[#18181D] px-3 py-1.5 text-xs font-medium text-[#D4D2CD] hover:border-[#EAB308] cursor-pointer"
              >
                {copiedJson ? <Check className="h-3.5 w-3.5 text-[#34D399]" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedJson ? 'Скопировано' : 'Копировать JSON'}</span>
              </button>
              <button
                type="button"
                data-testid="proc-export-all-zip-btn"
                onClick={() => {
                  const res = triggerFullExportZipDownload(1);
                  const totalBaked =
                    res.summary.totalUnitFramesBaked +
                    res.summary.totalBuildingFramesBaked +
                    res.summary.totalModelFramesBaked;
                  setFullExportInfo(
                    `${res.filename} · ${res.entries.length} файлов · ${totalBaked} спрайтов (${(res.zipBytes.length / 1024).toFixed(0)} КБ)`
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded bg-[#34D399] px-3.5 py-1.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#6EE7B7] cursor-pointer"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>Экспорт всего (PNG + JSON .zip)</span>
              </button>
            </div>
            {fullExportInfo && (
              <div
                data-testid="proc-export-all-status"
                className="rounded border border-[#34D399]/30 bg-[#34D399]/10 px-3 py-1.5 font-mono text-[11px] text-[#34D399]"
              >
                {fullExportInfo}
              </div>
            )}
          </div>

          {/* Live JSON Manifest Code Preview */}
          <div className="flex flex-col rounded-lg border border-[#24242B] bg-[#0E0E12] p-3 lg:col-span-6">
            <div className="mb-2 flex items-center justify-between text-[11px] text-[#8E8E98]">
              <span>Манифест JSON (координаты, якоря, державы, зоны K1/K2)</span>
              <span className="font-mono text-[#38BDF8]">
                {(packedAtlas.jsonString.length / 1024).toFixed(1)} КБ
              </span>
            </div>
            <pre
              data-testid="proc-json-preview"
              className="max-h-[260px] overflow-auto rounded bg-[#08080A] p-3 font-mono text-[10.5px] leading-relaxed text-[#C4C2BD]"
            >
              {jsonPreviewSnippet}
              {'\n  ...\n]'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
