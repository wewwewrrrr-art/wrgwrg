import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Crosshair,
  Download,
  Eye,
  Grid,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import {
  DEFAULT_CREATURE_GENES,
  GENE_APPENDAGE_OPTIONS,
  GENE_BIOME_OPTIONS,
  GENE_COAT_OPTIONS,
  GENE_SIZE_OPTIONS,
  serializeGenesKey,
} from '../engine/genes';
import { KINGDOM_PRESETS, SKIN_PHENOTYPES } from '../engine/palette';
import { buildFrameCacheKey } from '../engine/pixelCanvas';
import { UnitAction, UnitMode } from '../engine/unitAssembler';
import {
  BUILDING_FUNCTION_LABELS,
  BUILDING_STATE_OPTIONS,
  ENTITY_TYPE_LABELS,
  ERA_LABELS,
  getModelBuildingFunction,
  getModelEntityType,
  getModelEra,
  renderModelWithContext,
} from '../models';
import { BuildingState, CreatureGenes, PixelModelDef } from '../models/types';
import {
  downloadModelCodeJson,
  downloadModelCodeTs,
  generateModelJson,
  generateStandaloneModelTs,
} from '../utils/exportModelCode';
import { downloadModelFramePng, downloadModelSpriteSheetPng } from '../utils/exportPng';
import { PixelSpriteCanvas } from './PixelSpriteCanvas';

import { GalleryStageBg } from '../App';

interface InspectorModalProps {
  model: PixelModelDef | null;
  initialTab?: 'preview' | 'code';
  kingdomId: string;
  onKingdomChange: (kingdomId: string) => void;
  initialShowShadow?: boolean;
  initialStageBg?: GalleryStageBg;
  initialUnitAction?: UnitAction;
  initialBuildingState?: BuildingState;
  onClose: () => void;
}

const UNIT_ACTIONS: { id: UnitAction; label: string }[] = [
  { id: 'idle', label: 'Покой' },
  { id: 'normal', label: 'Шаг/Цикл' },
  { id: 'attack', label: 'Атака' },
  { id: 'hit', label: 'Урон' },
  { id: 'death', label: 'Смерть' },
  { id: 'zombie', label: 'Зомби' },
];

export function InspectorModal({
  model,
  initialTab = 'preview',
  kingdomId,
  onKingdomChange,
  initialShowShadow = false,
  initialStageBg = 'dark',
  initialUnitAction = 'normal',
  initialBuildingState = 'ready',
  onClose,
}: InspectorModalProps) {
  const [tab, setTab] = useState<'preview' | 'code'>(initialTab);
  const [codeFormat, setCodeFormat] = useState<'ts' | 'json'>('ts');
  const [isPlaying, setIsPlaying] = useState(() => (model ? model.frameCount > 1 : false));
  const [currentFrame, setCurrentFrame] = useState(0);
  const [zoom, setZoom] = useState(() =>
    model
      ? model.width <= 30
        ? 8
        : model.width <= 38
          ? 7
          : model.width <= 50
            ? 6
            : 5
      : 5
  );
  const [showGrid, setShowGrid] = useState(false);
  const [showAnchors, setShowAnchors] = useState(false);
  const [showShadow, setShowShadow] = useState(initialShowShadow);
  const [stageBg, setStageBg] = useState<GalleryStageBg>(initialStageBg);
  const [phenotypeId, setPhenotypeId] = useState<string>(
    () => model?.unitMeta?.defaultPhenotype ?? 'skin_light'
  );
  const [unitMode, setUnitMode] = useState<UnitMode>('walk');
  const [unitAction, setUnitAction] = useState<UnitAction>(initialUnitAction);
  const [buildingState, setBuildingState] = useState<BuildingState>(initialBuildingState);
  const [genes, setGenes] = useState<Required<CreatureGenes>>(DEFAULT_CREATURE_GENES);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (!model) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [model, onClose]);

  const entityType = model ? getModelEntityType(model) : 'nature';
  const isBuilding = entityType === 'building';
  const bFunc = model ? getModelBuildingFunction(model) : undefined;

  const telemetry = useMemo(() => {
    if (!model) return null;
    const raw = model.renderFrame(currentFrame, model.frameCount, {
      kingdomId,
      phenotypeId,
      unitMode,
      unitAction,
      showShadow: false,
      stageBg,
      genes,
      buildingState: isBuilding ? buildingState : 'ready',
    });
    const recolored = renderModelWithContext(model, currentFrame, {
      kingdomId,
      phenotypeId,
      unitMode,
      unitAction,
      showShadow,
      stageBg,
      genes,
      buildingState: isBuilding ? buildingState : 'ready',
    });
    const rawStats = raw.countPixelStats();
    const outStats = recolored.countPixelStats();
    const cacheKey = buildFrameCacheKey({
      modelId: model.id,
      frame: currentFrame,
      kingdomId,
      phenotypeId,
      unitMode,
      unitAction,
      showShadow,
      stageBg,
      genesKey: serializeGenesKey(genes),
      buildingState: isBuilding ? buildingState : 'ready',
    });
    return {
      opaquePixels: outStats.opaquePixels,
      uniqueColors: outStats.uniqueColors,
      maskPixels: rawStats.k1Pixels + rawStats.k2Pixels + rawStats.skinPixels,
      cacheKey,
    };
  }, [model, currentFrame, kingdomId, phenotypeId, unitMode, unitAction, showShadow, stageBg, genes, isBuilding, buildingState]);

  const exportedCode = useMemo(() => {
    if (!model || tab !== 'code') return '';
    const ctx = {
      kingdomId,
      phenotypeId,
      unitMode,
      unitAction,
      showShadow,
      stageBg,
      genes,
      buildingState: isBuilding ? buildingState : 'ready',
    };
    return codeFormat === 'ts'
      ? generateStandaloneModelTs(model, ctx)
      : generateModelJson(model, ctx);
  }, [model, tab, codeFormat, kingdomId, phenotypeId, unitMode, unitAction, showShadow, stageBg, genes, isBuilding, buildingState]);

  if (!model) return null;

  const isMultiFrame = model.frameCount > 1;
  const supportsActions =
    model.kind === 'unit' ||
    model.kind === 'aquatic' ||
    Boolean(model.unitMeta?.supportsActions);
  const supportsGenes =
    Boolean(model.unitMeta?.supportsGenes) || model.kind === 'unit' || model.kind === 'aquatic';
  const kindLabel = ENTITY_TYPE_LABELS[entityType];
  const funcLabel = bFunc ? BUILDING_FUNCTION_LABELS[bFunc] : null;
  const activeCtx = {
    kingdomId,
    phenotypeId,
    unitMode,
    unitAction,
    showShadow,
    stageBg,
    genes,
    buildingState: isBuilding ? buildingState : 'ready',
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(exportedCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const bgClass =
    stageBg === 'checker'
      ? 'checker-bg'
      : stageBg === 'meadow'
        ? 'meadow-bg'
        : stageBg === 'ocean'
          ? 'ocean-bg'
          : stageBg === 'parchment'
            ? 'bg-[#D6CBB3]'
            : 'bg-[#17171B]';

  const zoomOptions =
    model.width <= 32
      ? [6, 8, 10]
      : model.width <= 42
        ? [5, 7, 8]
        : [4, 5, 6];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspector-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#2C2C34] bg-[#111114]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-[#24242A] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#8E8E98]">
              <span className="text-[#EAB308]">{kindLabel}</span>
              {funcLabel && isBuilding && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#38BDF8]">{funcLabel}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#D4D2CD]">Ур. {model.tier}</span>
              <span aria-hidden="true">·</span>
              <span>{ERA_LABELS[getModelEra(model)]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {model.width}×{model.height} px
              </span>
            </div>
            <h2
              id="inspector-title"
              className="mt-1 truncate font-display text-2xl font-bold text-[#F4F2ED]"
            >
              {model.name}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#18181C] p-1">
              <button
                type="button"
                onClick={() => setTab('preview')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === 'preview'
                    ? 'bg-[#F4F2ED] text-[#0B0B0D]'
                    : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Сцена</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('code')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === 'code'
                    ? 'bg-[#F4F2ED] text-[#0B0B0D]'
                    : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>Код модели</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть инспектор"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#26262B] bg-[#18181C] text-[#A1A1AA] hover:border-[#4A4A54] hover:text-[#F4F2ED] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto p-6">
          {tab === 'preview' ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left Canvas Stage */}
              <div className="flex flex-col gap-4 lg:col-span-7">
                <div
                  className={`flex min-h-[340px] items-center justify-center overflow-auto rounded-xl border border-[#26262B] p-6 ${bgClass}`}
                >
                  <PixelSpriteCanvas
                    model={model}
                    scale={zoom}
                    isPlaying={isMultiFrame && isPlaying}
                    manualFrame={isMultiFrame && isPlaying ? undefined : currentFrame}
                    showGrid={showGrid}
                    showAnchors={showAnchors}
                    kingdomId={kingdomId}
                    phenotypeId={phenotypeId}
                    unitMode={unitMode}
                    unitAction={unitAction}
                    buildingState={isBuilding ? buildingState : 'ready'}
                    showShadow={showShadow}
                    stageBg={stageBg}
                    genes={genes}
                    onFrameChange={setCurrentFrame}
                  />
                </div>

                {isBuilding && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#24242A] bg-[#16161A] p-3.5">
                    <span className="text-xs text-[#A1A1AA]">Состояние постройки:</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {BUILDING_STATE_OPTIONS.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          data-testid={`inspector-building-state-${st.id}`}
                          aria-pressed={buildingState === st.id}
                          onClick={() => setBuildingState(st.id)}
                          className={`rounded px-2.5 py-1 text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                            buildingState === st.id
                              ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                              : 'bg-[#1F1F25] text-[#A1A1AA] hover:text-[#F4F2ED]'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live Unit & Aquatic Action & Swim Controls */}
                {supportsActions && (
                  <div className="flex flex-col gap-2.5 rounded-xl border border-[#24242A] bg-[#16161A] p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-[#A1A1AA]">
                        {model.kind === 'aquatic' ? 'Поведение (плавание / атака):' : 'Действие (целый спрайт):'}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {UNIT_ACTIONS.map((act) => (
                          <button
                            key={act.id}
                            type="button"
                            onClick={() => setUnitAction(act.id)}
                            className={`rounded px-2.5 py-1 text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                              unitAction === act.id
                                ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                                : 'bg-[#1F1F25] text-[#A1A1AA] hover:text-[#F4F2ED]'
                            }`}
                          >
                            {act.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {model.unitMeta?.supportsSwim && (
                      <div className="flex items-center justify-between gap-2 border-t border-[#222228] pt-2.5">
                        <span className="text-xs text-[#A1A1AA]">Среда (walk / swim):</span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { id: 'walk', label: 'Суша (walk)' },
                              { id: 'swim', label: 'Вода (swim)' },
                            ] as const
                          ).map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setUnitMode(m.id)}
                              className={`rounded px-2.5 py-1 text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                                unitMode === m.id
                                  ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                                  : 'bg-[#1F1F25] text-[#A1A1AA] hover:text-[#F4F2ED]'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isMultiFrame ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#24242A] bg-[#16161A] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="Предыдущий кадр"
                        onClick={() => {
                          setIsPlaying(false);
                          setCurrentFrame(
                            (f) => (f - 1 + model.frameCount) % model.frameCount
                          );
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2E2E36] bg-[#1F1F25] text-[#E4E2DD] hover:border-[#4A4A54] cursor-pointer"
                      >
                        <SkipBack className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
                        onClick={() => setIsPlaying((p) => !p)}
                        className="flex h-8 items-center gap-1.5 rounded-md bg-[#EAB308] px-3 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] cursor-pointer"
                      >
                        {isPlaying ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        <span>{isPlaying ? 'Пауза' : 'Пуск'}</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Следующий кадр"
                        onClick={() => {
                          setIsPlaying(false);
                          setCurrentFrame((f) => (f + 1) % model.frameCount);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2E2E36] bg-[#1F1F25] text-[#E4E2DD] hover:border-[#4A4A54] cursor-pointer"
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <label htmlFor="frame-slider" className="font-mono text-xs text-[#A1A1AA] tabular-nums">
                        Кадр {currentFrame + 1}/{model.frameCount}
                      </label>
                      <input
                        id="frame-slider"
                        type="range"
                        min={0}
                        max={model.frameCount - 1}
                        value={currentFrame}
                        onChange={(e) => {
                          setIsPlaying(false);
                          setCurrentFrame(Number(e.target.value));
                        }}
                        className="w-28 accent-[#EAB308] cursor-pointer"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border border-[#24242A] bg-[#16161A] px-4 py-3 text-xs text-[#A1A1AA]">
                    <span>Статичная архитектурная постройка</span>
                    <span className="font-mono text-[#F4F2ED] tabular-nums">1 кадр</span>
                  </div>
                )}
              </div>

              {/* Right Details & Controls */}
              <div className="flex flex-col justify-between gap-3 lg:col-span-5">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold tracking-wide text-[#8E8E98]">
                      Устройство и архитектура
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#D4D2CD]">
                      {model.description}
                    </p>
                  </div>

                  {model.attackName && (
                    <div className="rounded-lg border border-[#38BDF8]/30 bg-[#38BDF8]/10 px-3 py-1.5 text-xs">
                      <span className="text-[#8E8E98]">Уникальная атака: </span>
                      <span className="font-semibold text-[#38BDF8]">{model.attackName}</span>
                    </div>
                  )}

                  <div>
                    <h3 className="text-xs font-semibold tracking-wide text-[#8E8E98]">
                      Слои сборки
                    </h3>
                    <ul className="mt-1 space-y-0.5 text-xs text-[#A1A1AA]">
                      {model.layersSpec.map((layer) => (
                        <li key={layer} className="leading-snug">
                          {layer}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {telemetry && (
                    <div className="grid grid-cols-3 gap-2 border-t border-[#24242A] pt-2.5 text-xs">
                      <div>
                        <div className="text-[#8E8E98]">Пиксели</div>
                        <div className="font-mono font-semibold text-[#F4F2ED] tabular-nums">
                          {telemetry.opaquePixels} px
                        </div>
                      </div>
                      <div>
                        <div className="text-[#8E8E98]">Цвета</div>
                        <div className="font-mono font-semibold text-[#F4F2ED] tabular-nums">
                          {telemetry.uniqueColors}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#8E8E98]">Маски</div>
                        <div className="font-mono font-semibold text-[#F4F2ED] tabular-nums">
                          {telemetry.maskPixels} px
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Recolor & Stage Controls */}
                  <div className="space-y-2 border-t border-[#24242A] pt-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#A1A1AA]">Королевство</span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {KINGDOM_PRESETS.slice(0, 6).map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            title={k.name}
                            aria-label={`Королевство: ${k.name}`}
                            onClick={() => onKingdomChange(k.id)}
                            className={`h-5 w-5 rounded border cursor-pointer ${
                              kingdomId === k.id
                                ? 'border-[#F4F2ED] ring-1 ring-[#F4F2ED]'
                                : 'border-white/20 opacity-80 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: k.primaryHex }}
                          />
                        ))}
                      </div>
                    </div>

                    {model.unitMeta?.usesSkinMask && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[#A1A1AA]">Фенотип кожи</span>
                        <select
                          aria-label="Фенотип кожи"
                          value={phenotypeId}
                          onChange={(e) => setPhenotypeId(e.target.value)}
                          className="rounded border border-[#2E2E36] bg-[#1B1B20] px-2 py-1 text-xs text-[#F4F2ED] focus-visible:outline-2 focus-visible:outline-[#EAB308]"
                        >
                          {SKIN_PHENOTYPES.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {supportsGenes && (
                      <div className="space-y-2 border-t border-[#222228] pt-2.5">
                        <div className="text-xs font-medium text-[#EAB308]">Гены подвида</div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1 text-[11px] text-[#A1A1AA]">
                            <span>Размер</span>
                            <select
                              aria-label="Ген размера"
                              data-testid="gene-size-select"
                              value={genes.size}
                              onChange={(e) =>
                                setGenes((prev) => ({
                                  ...prev,
                                  size: e.target.value as Required<CreatureGenes>['size'],
                                }))
                              }
                              className="rounded border border-[#2E2E36] bg-[#1B1B20] px-2 py-1 text-xs text-[#F4F2ED]"
                            >
                              {GENE_SIZE_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] text-[#A1A1AA]">
                            <span>Окрас</span>
                            <select
                              aria-label="Ген окраса"
                              data-testid="gene-coat-select"
                              value={genes.coat}
                              onChange={(e) =>
                                setGenes((prev) => ({
                                  ...prev,
                                  coat: e.target.value as Required<CreatureGenes>['coat'],
                                }))
                              }
                              className="rounded border border-[#2E2E36] bg-[#1B1B20] px-2 py-1 text-xs text-[#F4F2ED]"
                            >
                              {GENE_COAT_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] text-[#A1A1AA]">
                            <span>Рога / Перья</span>
                            <select
                              aria-label="Ген рогов и перьев"
                              data-testid="gene-appendages-select"
                              value={genes.appendages}
                              onChange={(e) =>
                                setGenes((prev) => ({
                                  ...prev,
                                  appendages: e.target.value as Required<CreatureGenes>['appendages'],
                                }))
                              }
                              className="rounded border border-[#2E2E36] bg-[#1B1B20] px-2 py-1 text-xs text-[#F4F2ED]"
                            >
                              {GENE_APPENDAGE_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] text-[#A1A1AA]">
                            <span>Биом</span>
                            <select
                              aria-label="Ген биома"
                              data-testid="gene-biome-select"
                              value={genes.biomeTint}
                              onChange={(e) =>
                                setGenes((prev) => ({
                                  ...prev,
                                  biomeTint: e.target.value as Required<CreatureGenes>['biomeTint'],
                                }))
                              }
                              className="rounded border border-[#2E2E36] bg-[#1B1B20] px-2 py-1 text-xs text-[#F4F2ED]"
                            >
                              {GENE_BIOME_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#A1A1AA]">Масштаб</span>
                      <div className="flex items-center gap-1">
                        {zoomOptions.map((z) => (
                          <button
                            key={z}
                            type="button"
                            onClick={() => setZoom(z)}
                            className={`rounded px-2.5 py-1 font-mono text-xs cursor-pointer ${
                              zoom === z
                                ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                                : 'bg-[#1B1B20] text-[#A1A1AA] hover:text-[#F4F2ED]'
                            }`}
                          >
                            {z}×
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#A1A1AA]">Фон сцены</span>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {(
                          [
                            { id: 'dark', label: 'Тёмный' },
                            { id: 'ocean', label: 'Вода' },
                            { id: 'meadow', label: 'Поляна' },
                            { id: 'checker', label: 'Сетка' },
                            { id: 'parchment', label: 'Светлый' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setStageBg(opt.id)}
                            className={`rounded px-2 py-1 text-xs cursor-pointer ${
                              stageBg === opt.id
                                ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                                : 'bg-[#1B1B20] text-[#A1A1AA] hover:text-[#F4F2ED]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#A1A1AA]">Оверлеи</span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {model.supportsShadow !== false && (
                          <button
                            type="button"
                            onClick={() => setShowShadow((s) => !s)}
                            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs cursor-pointer ${
                              showShadow
                                ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                                : 'bg-[#1B1B20] text-[#A1A1AA] hover:text-[#F4F2ED]'
                            }`}
                          >
                            <span>Тень</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowGrid((g) => !g)}
                          className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs cursor-pointer ${
                            showGrid
                              ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                              : 'bg-[#1B1B20] text-[#A1A1AA] hover:text-[#F4F2ED]'
                          }`}
                        >
                          <Grid className="h-3.5 w-3.5" />
                          <span>Сетка</span>
                        </button>
                        {model.getAnchors && (
                          <button
                            type="button"
                            onClick={() => setShowAnchors((a) => !a)}
                            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs cursor-pointer ${
                              showAnchors
                                ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                                : 'bg-[#1B1B20] text-[#A1A1AA] hover:text-[#F4F2ED]'
                            }`}
                          >
                            <Crosshair className="h-3.5 w-3.5" />
                            <span>Якоря</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-[#24242A] pt-4">
                  {isMultiFrame && (
                    <button
                      type="button"
                      onClick={() => downloadModelSpriteSheetPng(model, 4, activeCtx)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#EAB308] px-4 py-2.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] transition-colors cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Скачать спрайт-лист ({model.frameCount} к. PNG)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => downloadModelFramePng(model, currentFrame, 8, activeCtx)}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                      isMultiFrame
                        ? 'border border-[#2E2E36] bg-[#18181C] text-[#E4E2DD] hover:border-[#4A4A54]'
                        : 'bg-[#EAB308] text-[#0B0B0D] hover:bg-[#FACC15]'
                    }`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Скачать модель (8× PNG)</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 border-b border-[#24242A] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="Формат экспорта кода"
                    className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#18181C] p-1"
                  >
                    <button
                      type="button"
                      onClick={() => setCodeFormat('ts')}
                      className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        codeFormat === 'ts'
                          ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                          : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                      }`}
                    >
                      Автономный TypeScript (.ts)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCodeFormat('json')}
                      className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        codeFormat === 'json'
                          ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                          : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                      }`}
                    >
                      JSON-матрица (.json)
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E36] bg-[#18181C] px-3 py-1.5 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#EAB308]" />
                        <span className="text-[#EAB308]">Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Копировать</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadModelCodeTs(model, activeCtx)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#EAB308] px-3 py-1.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Скачать .ts</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadModelCodeJson(model, activeCtx)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E36] bg-[#18181C] px-3 py-1.5 text-xs font-medium text-[#F4F2ED] hover:border-[#4A4A54] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Скачать .json</span>
                  </button>
                </div>
              </div>

              <p className="text-xs text-[#8E8E98]">
                {codeFormat === 'ts'
                  ? `Полностью автономный TypeScript-модуль (${model.id}.model.ts): содержит встроенный PixelBuffer, палитру, перекраску масок K1/K2/Skin, покадровые RLE-матрицы и чертёж генератора без внешних зависимостей.`
                  : `Структурированный JSON-паспорт (${model.id}.model.json): метаданные, якоря (anchors), маппинг масок и точная RLE-матрица всех ${model.frameCount} кадров.`}
              </p>

              <pre
                data-testid="model-code-preview"
                className="max-h-[54vh] overflow-auto rounded-xl border border-[#26262B] bg-[#0B0B0D] p-5 font-mono text-xs leading-relaxed text-[#E4E2DD]"
              >
                <code>{exportedCode}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
