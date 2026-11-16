import { Code2, Layers, Maximize2, Pause, Play } from 'lucide-react';
import { GalleryStageBg } from '../App';
import { KINGDOM_PRESETS } from '../engine/palette';
import {
  BUILDING_FUNCTION_LABELS,
  BUILDING_STATE_OPTIONS,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_TABS,
  ERA_LABELS,
  ERA_TABS,
  EntityTypeFilter,
  EraFilter,
  FILTER_TABS,
  FilterTab,
  TIER_TABS,
  TierFilter,
  getEraTypeSummaryMatrix,
  getModelBuildingFunction,
  getModelEntityType,
  getModelEra,
} from '../models';
import { BuildingState, PixelModelDef } from '../models/types';
import { PixelSpriteCanvas } from './PixelSpriteCanvas';

interface ModelGalleryProps {
  models: PixelModelDef[];
  activeFilter: FilterTab;
  onFilterChange: (tab: FilterTab) => void;
  entityTypeFilter: EntityTypeFilter;
  onEntityTypeFilterChange: (t: EntityTypeFilter) => void;
  tierFilter: TierFilter;
  onTierFilterChange: (tier: TierFilter) => void;
  eraFilter: EraFilter;
  onEraFilterChange: (era: EraFilter) => void;
  isPlaying: boolean;
  onTogglePlaying: () => void;
  speedMultiplier: number;
  onSpeedChange: (speed: number) => void;
  cardScale: number;
  onCardScaleChange: (scale: number) => void;
  kingdomId: string;
  onKingdomChange: (kingdomId: string) => void;
  showShadow: boolean;
  onToggleShadow: () => void;
  stageBg: GalleryStageBg;
  onStageBgChange: (bg: GalleryStageBg) => void;
  galleryAction: 'idle' | 'normal' | 'attack';
  onGalleryActionChange: (action: 'idle' | 'normal' | 'attack') => void;
  buildingState: BuildingState;
  onBuildingStateChange: (state: BuildingState) => void;
  onInspectModel: (model: PixelModelDef, initialTab?: 'preview' | 'code') => void;
}

const SPEED_OPTIONS = [0.5, 1, 2];
const SCALE_OPTIONS = [
  { label: '2×', value: 2 },
  { label: '3×', value: 3 },
  { label: '4×', value: 4 },
];
const STAGE_OPTIONS: { id: GalleryStageBg; label: string }[] = [
  { id: 'dark', label: 'Тёмный' },
  { id: 'ocean', label: 'Вода' },
  { id: 'meadow', label: 'Поляна' },
  { id: 'checker', label: 'Сетка' },
  { id: 'parchment', label: 'Светлый' },
];

const ENTITY_BADGE_COLOR: Record<ReturnType<typeof getModelEntityType>, string> = {
  creature: 'text-[#38BDF8]',
  unit: 'text-[#FBBF24]',
  building: 'text-[#EAB308]',
  nature: 'text-[#73F2A6]',
};

export function ModelGallery({
  models,
  activeFilter,
  onFilterChange,
  entityTypeFilter,
  onEntityTypeFilterChange,
  tierFilter,
  onTierFilterChange,
  eraFilter,
  onEraFilterChange,
  isPlaying,
  onTogglePlaying,
  speedMultiplier,
  onSpeedChange,
  cardScale,
  onCardScaleChange,
  kingdomId,
  onKingdomChange,
  showShadow,
  onToggleShadow,
  stageBg,
  onStageBgChange,
  galleryAction,
  onGalleryActionChange,
  buildingState,
  onBuildingStateChange,
  onInspectModel,
}: ModelGalleryProps) {
  const summaryRows = getEraTypeSummaryMatrix();
  const stageClass =
    stageBg === 'checker'
      ? 'checker-bg'
      : stageBg === 'meadow'
        ? 'meadow-bg'
        : stageBg === 'ocean'
          ? 'ocean-bg'
          : stageBg === 'parchment'
            ? 'bg-[#D6CBB3]'
            : 'bg-[#1B1B20]';

  return (
    <section id="gallery" className="mx-auto max-w-[1280px] px-6 py-14">
      <div className="flex flex-col gap-6 border-b border-[#26262B] pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight text-[#F4F2ED]">
            Коллекция моделей, водных монстров, природы и погоды
          </h2>
          <p className="mt-2 text-sm text-[#A1A1AA]">
            Отображается <span className="font-mono text-[#F4F2ED] tabular-nums">{models.length}</span>{' '}
            позиций: водные хищники с уникальными атаками, природа, вещества, погода, постройки и юниты
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Режим анимации существ"
            className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#121215] p-1"
          >
            <button
              type="button"
              data-testid="gallery-action-idle"
              aria-pressed={galleryAction === 'idle'}
              onClick={() => onGalleryActionChange('idle')}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                galleryAction === 'idle'
                  ? 'bg-[#26262D] font-semibold text-[#F4F2ED]'
                  : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
              }`}
            >
              Покой
            </button>
            <button
              type="button"
              data-testid="gallery-action-normal"
              aria-pressed={galleryAction === 'normal'}
              onClick={() => onGalleryActionChange('normal')}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                galleryAction === 'normal'
                  ? 'bg-[#26262D] font-semibold text-[#F4F2ED]'
                  : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
              }`}
            >
              Цикл (Плавание/Шаг)
            </button>
            <button
              type="button"
              data-testid="gallery-action-attack"
              aria-pressed={galleryAction === 'attack'}
              onClick={() => onGalleryActionChange('attack')}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                galleryAction === 'attack'
                  ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                  : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
              }`}
            >
              Уникальная атака
            </button>
          </div>

          <button
            type="button"
            onClick={onTogglePlaying}
            className="inline-flex items-center gap-2 rounded-lg border border-[#2E2E34] bg-[#141417] px-3.5 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#4A4A54] hover:bg-[#1B1B20] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? 'Пауза' : 'Воспроизвести'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleShadow}
            aria-pressed={showShadow}
            data-testid="toggle-shadows-btn"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
              showShadow
                ? 'border-[#EAB308] bg-[#EAB308]/15 text-[#EAB308]'
                : 'border-[#2E2E34] bg-[#141417] text-[#A1A1AA] hover:border-[#4A4A54] hover:text-[#F4F2ED]'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{showShadow ? 'Тени: Вкл' : 'Тени: Выкл'}</span>
          </button>

          <div
            role="group"
            aria-label="Фон карточек"
            className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#121215] p-1"
          >
            {STAGE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onStageBgChange(opt.id)}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                  stageBg === opt.id
                    ? 'bg-[#26262D] font-semibold text-[#F4F2ED]'
                    : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Скорость анимации"
            className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#121215] p-1"
          >
            {SPEED_OPTIONS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onSpeedChange(spd)}
                className={`rounded-md px-2.5 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                  speedMultiplier === spd
                    ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                    : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                }`}
              >
                {spd}×
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Масштаб карточек"
            className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#121215] p-1"
          >
            {SCALE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onCardScaleChange(opt.value)}
                className={`rounded-md px-2.5 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                  cardScale === opt.value
                    ? 'bg-[#26262D] font-semibold text-[#F4F2ED]'
                    : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Segmented Tabs + Tier Filter + Live Kingdom Mask Switcher */}
      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Тип моделей">
            {FILTER_TABS.map((tab) => {
              const active = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onFilterChange(tab.id)}
                  className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                    active
                      ? 'bg-[#F4F2ED] text-[#0B0B0D]'
                      : 'border border-[#26262B] bg-[#131316] text-[#A1A1AA] hover:border-[#3A3A42] hover:text-[#F4F2ED]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label="Уровень развития"
            className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#121215] p-1"
          >
            {TIER_TABS.map((t) => {
              const active = tierFilter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onTierFilterChange(t.id)}
                  className={`rounded-md px-2.5 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                    active
                      ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                      : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Entity Type Filter Bar (Существа / Юниты / Постройки / Природа) */}
        <div
          role="tablist"
          aria-label="Фильтр по типу сущности"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-[#8E8E98]">Тип:</span>
            {ENTITY_TYPE_TABS.map((et) => {
              const active = entityTypeFilter === et.id;
              return (
                <button
                  key={et.id}
                  type="button"
                  role="tab"
                  data-testid={`entity-type-tab-${et.id}`}
                  aria-selected={active}
                  onClick={() => onEntityTypeFilterChange(et.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                    active
                      ? 'bg-[#38BDF8] text-[#0B0B0D] font-semibold'
                      : 'border border-[#26262B] bg-[#131316] text-[#A1A1AA] hover:border-[#3A3A42] hover:text-[#F4F2ED]'
                  }`}
                >
                  {et.label}
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label="Состояние построек"
            className="flex flex-wrap items-center gap-1 rounded-lg border border-[#26262B] bg-[#121215] p-1"
          >
            <span className="px-2 text-xs text-[#8E8E98] whitespace-nowrap">Постройки:</span>
            {BUILDING_STATE_OPTIONS.map((st) => {
              const active = buildingState === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  data-testid={`gallery-building-state-${st.id}`}
                  aria-pressed={active}
                  onClick={() => onBuildingStateChange(st.id)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                    active
                      ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                      : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                  }`}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Historical Era Filter Bar */}
        <div
          role="tablist"
          aria-label="Фильтр по эпохам"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="mr-1 text-xs font-medium text-[#8E8E98]">Эпоха:</span>
          {ERA_TABS.map((era) => {
            const active = eraFilter === era.id;
            return (
              <button
                key={era.id}
                type="button"
                role="tab"
                data-testid={`era-tab-${era.id}`}
                aria-selected={active}
                onClick={() => onEraFilterChange(era.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                  active
                    ? 'bg-[#EAB308] text-[#0B0B0D] font-semibold'
                    : 'border border-[#26262B] bg-[#131316] text-[#A1A1AA] hover:border-[#3A3A42] hover:text-[#F4F2ED]'
                }`}
              >
                {era.label}
              </button>
            );
          })}
        </div>

        <div
          role="group"
          aria-label="Перекраска королевства"
          className="flex flex-wrap items-center gap-1.5 self-start rounded-xl border border-[#26262B] bg-[#121215] px-3 py-1.5"
        >
          <span className="mr-1.5 text-xs text-[#8E8E98] whitespace-nowrap">
            Цвет державы:
          </span>
          {KINGDOM_PRESETS.map((k) => {
            const active = kingdomId === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => onKingdomChange(k.id)}
                aria-pressed={active}
                aria-label={`Цвет королевства: ${k.name}`}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${
                  active
                    ? 'bg-[#26262E] font-medium text-[#F4F2ED]'
                    : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                }`}
              >
                <span
                  className="h-3 w-3 rounded-sm border border-white/20 shrink-0"
                  style={{ backgroundColor: k.primaryHex }}
                  aria-hidden="true"
                />
                <span>{k.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Compact Interactive Era × Type Summary Matrix */}
      <div
        data-testid="era-type-summary"
        className="mt-6 overflow-x-auto rounded-xl border border-[#26262B] bg-[#121215]"
      >
        <div className="flex items-center justify-between border-b border-[#222228] px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA]">
            Сводка: Эпоха × Тип (нажмите ячейку для фильтра)
          </span>
          {(eraFilter !== 'all' || entityTypeFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                onEraFilterChange('all');
                onEntityTypeFilterChange('all');
              }}
              className="text-xs text-[#EAB308] hover:underline cursor-pointer"
            >
              Сбросить фильтр
            </button>
          )}
        </div>
        <table className="w-full text-left text-xs">
          <thead className="border-b border-[#222228] text-[11px] uppercase tracking-wider text-[#8E8E98]">
            <tr>
              <th className="px-4 py-2 font-medium">Эпоха / Категория</th>
              <th className="px-3 py-2 text-right font-medium text-[#38BDF8]">Существа</th>
              <th className="px-3 py-2 text-right font-medium text-[#FBBF24]">Юниты</th>
              <th className="px-3 py-2 text-right font-medium text-[#EAB308]">Постройки</th>
              <th className="px-3 py-2 text-right font-medium text-[#73F2A6]">Природа</th>
              <th className="px-4 py-2 text-right font-medium text-[#F4F2ED]">Всего</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E1E24]">
            {summaryRows.map((row) => {
              const rowActive = eraFilter === row.era;
              const cellCls = (et: EntityTypeFilter, count: number) =>
                `w-full rounded px-2 py-1 text-right font-mono tabular-nums transition-colors cursor-pointer ${
                  rowActive && entityTypeFilter === et
                    ? 'bg-[#EAB308] font-bold text-[#0B0B0D]'
                    : count === 0
                      ? 'text-[#52525B] hover:bg-[#1B1B20]'
                      : 'text-[#D4D4D8] hover:bg-[#1E1E25] hover:text-[#F4F2ED]'
                }`;
              return (
                <tr key={row.era} className={rowActive ? 'bg-[#191920]' : ''}>
                  <td className="px-4 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onEraFilterChange(row.era);
                        onEntityTypeFilterChange('all');
                      }}
                      className={`text-left font-medium transition-colors cursor-pointer ${
                        rowActive ? 'text-[#EAB308]' : 'text-[#F4F2ED] hover:text-[#EAB308]'
                      }`}
                    >
                      {row.label}
                    </button>
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        onEraFilterChange(row.era);
                        onEntityTypeFilterChange('creature');
                      }}
                      className={cellCls('creature', row.creature)}
                    >
                      {row.creature}
                    </button>
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        onEraFilterChange(row.era);
                        onEntityTypeFilterChange('unit');
                      }}
                      className={cellCls('unit', row.unit)}
                    >
                      {row.unit}
                    </button>
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        onEraFilterChange(row.era);
                        onEntityTypeFilterChange('building');
                      }}
                      className={cellCls('building', row.building)}
                    >
                      {row.building}
                    </button>
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        onEraFilterChange(row.era);
                        onEntityTypeFilterChange('nature');
                      }}
                      className={cellCls('nature', row.nature)}
                    >
                      {row.nature}
                    </button>
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        onEraFilterChange(row.era);
                        onEntityTypeFilterChange('all');
                      }}
                      className={cellCls('all', row.total)}
                    >
                      {row.total}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cards Grid */}
      {models.length === 0 ? (
        <div
          data-testid="empty-gallery-notice"
          className="mt-8 rounded-2xl border border-[#26262B] bg-[#131316] px-6 py-12 text-center text-sm text-[#A1A1AA]"
        >
          В выбранном сочетании фильтров («Эпоха» и «Тип») моделей нет. Например, в эпохах «Первобытная жизнь» и «Динозавры» построек нет.
        </div>
      ) : (
        <div
          data-testid="model-grid"
          className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {models.map((model) => {
            const entityType = getModelEntityType(model);
            const badgeColor = ENTITY_BADGE_COLOR[entityType];
            const entityLabel = ENTITY_TYPE_LABELS[entityType];
            const bFunc = getModelBuildingFunction(model);
            const funcLabel = bFunc ? BUILDING_FUNCTION_LABELS[bFunc] : null;
            const maxDim = Math.max(model.width, model.height);
            const effectiveScale =
              model.kind === 'unit'
                ? maxDim > 56
                  ? Math.min(5, cardScale + 2)
                  : maxDim > 48
                    ? Math.min(5, cardScale + 1)
                    : model.width <= 26
                      ? cardScale + 3
                      : cardScale + 2
                : maxDim <= 40
                  ? Math.min(6, cardScale + 2)
                  : maxDim <= 52
                    ? Math.min(5, cardScale + 1)
                    : cardScale;

            const footerNote =
              model.kind === 'aquatic'
                ? `Атака: ${model.attackName ?? 'Уникальный удар'}`
                : model.kind === 'unit'
                  ? model.attackName
                    ? `Атака: ${model.attackName}`
                    : showShadow
                      ? 'Маски K1/K2 · мягкая тень'
                      : 'Маски K1/K2 · без тени'
                  : entityType === 'building'
                    ? `${funcLabel ?? 'Постройка'} · 4 состояния`
                    : model.kind === 'weather'
                      ? 'Погода/VFX · полупрозрачность α'
                      : model.kind === 'nature'
                        ? 'Природа · ветер и объём кроны'
                        : model.kind === 'substance'
                          ? 'Вещество · фактура материала'
                          : `${model.layersSpec.length} подслоёв · без контура`;

            return (
              <article
                key={model.id}
                data-testid={`model-card-${model.id}`}
                className="group flex flex-col justify-between rounded-2xl border border-[#26262B] bg-[#131316] p-5 transition-colors hover:border-[#42424C]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 text-xs text-[#8E8E98]">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                      <span className={`${badgeColor} whitespace-nowrap shrink-0 font-medium`}>
                        {entityLabel}
                      </span>
                      {funcLabel && entityType === 'building' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#D4D2CD] whitespace-nowrap shrink-0">
                            {funcLabel}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[#D4D2CD] whitespace-nowrap shrink-0">
                        Ур. {model.tier}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="whitespace-nowrap">
                        {ERA_LABELS[getModelEra(model)]}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums whitespace-nowrap shrink-0 pt-0.5">
                      {model.width}×{model.height} · {model.frameCount === 1 ? '1 к.' : `${model.frameCount} к.`}
                    </span>
                  </div>

                  <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-[#F4F2ED]">
                    {model.name}
                  </h3>
                  <p className="mt-1 text-xs text-[#A1A1AA]">{model.subtitle}</p>

                  <button
                    type="button"
                    onClick={() => onInspectModel(model, 'preview')}
                    aria-label={`Открыть инспектор модели ${model.name}`}
                    className={`mt-4 flex h-[296px] w-full items-center justify-center overflow-hidden rounded-xl border border-[#222228] p-4 transition-colors group-hover:border-[#34343D] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308] ${stageClass}`}
                  >
                    <PixelSpriteCanvas
                      model={model}
                      scale={effectiveScale}
                      isPlaying={isPlaying && model.frameCount > 1}
                      speedMultiplier={speedMultiplier}
                      kingdomId={kingdomId}
                      unitAction={galleryAction}
                      buildingState={entityType === 'building' ? buildingState : 'ready'}
                      showShadow={showShadow}
                      stageBg={stageBg}
                    />
                  </button>
                </div>

                <div className="mt-4">
                  <p className="text-xs leading-relaxed text-[#A1A1AA]">
                    {model.description}
                  </p>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#222228] pt-3">
                    <span className="truncate pr-2 text-xs text-[#8E8E98]">
                      {footerNote}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onInspectModel(model, 'code')}
                        data-testid={`export-code-${model.id}`}
                        aria-label={`Экспортировать код модели ${model.name}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[#D4D2CD] hover:bg-[#26262E] hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                        <span>Код</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onInspectModel(model, 'preview')}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[#EAB308] hover:bg-[#EAB308]/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span>Инспектор</span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
