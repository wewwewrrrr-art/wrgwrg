import { Dna, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FIVE_SHOWCASE_SPECIES,
  ModelPhenotypeSchema,
  generateDistinctModelVariants,
  getAllModelPhenotypeSchemas,
} from '../engine/phenotypeRegistry';
import { PixelBuffer } from '../engine/pixelCanvas';
import { ALL_MODELS, ERA_TABS, EraFilter } from '../models';
import type { GenePattern, PixelModelDef } from '../models/types';

function drawBuf(canvas: HTMLCanvasElement | null, buf: PixelBuffer, scale: number): void {
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

function PhenoCanvas({
  buffer,
  scale,
  ariaLabel,
  exactSize = false,
}: {
  buffer: PixelBuffer;
  scale: number;
  ariaLabel: string;
  exactSize?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    drawBuf(ref.current, buffer, scale);
  }, [buffer, scale]);

  return (
    <canvas
      ref={ref}
      aria-label={ariaLabel}
      width={buffer.width * scale}
      height={buffer.height * scale}
      className={`pixelated-canvas block ${exactSize ? 'shrink-0' : 'max-w-full h-auto'}`}
    />
  );
}

const PATTERN_RU: Readonly<Record<GenePattern, string>> = {
  solid: 'однотонный',
  striped: 'полосатый',
  spotted: 'пятнистый',
  dappled: 'крапчатый',
};

export function ProceduralPhenotypeShowcase() {
  const modelsById = useMemo(
    () => new Map<string, PixelModelDef>(ALL_MODELS.map((m) => [m.id, m])),
    []
  );

  const [showcaseScale, setShowcaseScale] = useState<2 | 4>(4);

  // 1. All 5 showcase species × 12 distinct individuals = 60 visible individuals
  const fiveByTwelveGroups = useMemo(() => {
    return FIVE_SHOWCASE_SPECIES.map((spec) => {
      const model = modelsById.get(spec.modelId);
      const variants = model
        ? generateDistinctModelVariants(model, 12, {
            includeSizes: true,
            stageBg: 'dark',
            withShadow: true,
          })
        : [];
      return {
        spec,
        model,
        variants,
      };
    });
  }, [modelsById]);

  // 2. Full 205-model phenotype schema table
  const allSchemas = useMemo<readonly ModelPhenotypeSchema[]>(
    () => getAllModelPhenotypeSchemas(ALL_MODELS),
    []
  );

  const [eraFilter, setEraFilter] = useState<EraFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inspectedModelId, setInspectedModelId] = useState<string>('dire-wolf');

  const filteredSchemas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allSchemas.filter((row) => {
      if (eraFilter !== 'all' && row.era !== eraFilter) return false;
      if (
        q.length > 0 &&
        !row.modelName.toLowerCase().includes(q) &&
        !row.modelId.toLowerCase().includes(q) &&
        !row.zoneScheme.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allSchemas, eraFilter, searchQuery]);

  const inspectedModel = modelsById.get(inspectedModelId) ?? ALL_MODELS[0];
  const inspectedVariants = useMemo(
    () =>
      generateDistinctModelVariants(inspectedModel, 8, {
        includeSizes: true,
        stageBg: 'dark',
        withShadow: true,
      }),
    [inspectedModel]
  );

  return (
    <div className="space-y-8">
      {/* SHOWCASE: 12 DISTINCT INDIVIDUALS × 5 SPECIES (WOLF, MAMMOTH, T-REX, SHARK, BEAR) */}
      <div
        data-testid="proc-five-species-twelve"
        className="rounded-xl border border-[#26262B] bg-[#121216] p-5"
      >
        <div className="flex flex-col gap-3 border-b border-[#222228] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#34D399]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Популяционное разнообразие · 5 видов × 12 уникальных особей ({showcaseScale}×)</span>
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F2ED]">
              По 12 разных особей: Волк, Мамонт, Тираннозавр, Акула и Медведь
            </h3>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              Комбинации окраса (природный, меланист, альбинос, тигровый), узоров (полосы, пятна, крап), биомов и размеров сохраняют узнаваемость вида и 0 обводки INK.
            </p>
          </div>
          <div className="flex items-center gap-1 self-start rounded border border-[#26262E] bg-[#18181E] p-0.5 text-[11px]">
            {([2, 4] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                data-testid={`proc-pheno-scale-${sc}`}
                onClick={() => setShowcaseScale(sc)}
                className={`rounded px-2.5 py-1 cursor-pointer ${
                  showcaseScale === sc
                    ? 'bg-[#34D399] font-semibold text-[#0B0B0D]'
                    : 'text-[#C4C2BD]'
                }`}
              >
                {sc}×
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-6">
          {fiveByTwelveGroups.map(({ spec, model, variants }) => {
            if (!model) return null;
            const gridCols =
              showcaseScale === 4
                ? model.width >= 48
                  ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
                  : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'
                : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6';
            return (
              <div
                key={spec.modelId}
                data-testid={`proc-species-12-${spec.modelId}`}
                className="rounded-lg border border-[#222229] bg-[#16161B] p-4"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-[#F4F2ED]">
                      {spec.title}{' '}
                      <span className="font-mono text-[11px] font-normal text-[#8E8E98]">
                        ({model.name} · {variants.length}/12 особей · {showcaseScale}×)
                      </span>
                    </h4>
                    <p className="text-[11px] text-[#A1A1AA]">{spec.subtitle}</p>
                  </div>
                  <span className="font-mono text-[11px] text-[#34D399]">
                    IoU min: {Math.min(...variants.map((v) => v.silhouetteIoU)).toFixed(2)} · INK: 0
                  </span>
                </div>

                <div className={`grid gap-2.5 ${gridCols}`}>
                  {variants.map((v) => (
                    <div
                      key={`${v.modelId}-${v.index}-${v.pixelHash}`}
                      className="flex flex-col items-center justify-between rounded border border-[#25252C] bg-[#1A1A21] p-2"
                      title={`${v.label} · IoU ${v.silhouetteIoU}`}
                    >
                      <div className="flex min-h-[84px] w-full items-center justify-center overflow-x-auto rounded bg-[#243627] p-1.5">
                        <PhenoCanvas
                          buffer={v.buffer}
                          scale={showcaseScale}
                          exactSize={showcaseScale === 4}
                          ariaLabel={`${spec.title} #${v.index + 1}: ${v.label}`}
                        />
                      </div>
                      <span className="mt-1.5 w-full truncate text-center text-[10px] leading-tight text-[#C4C2BD]">
                        #{v.index + 1} {v.label.split(' · ')[0]}
                      </span>
                      <span className="w-full truncate text-center font-mono text-[9px] text-[#8E8E98]">
                        {v.label.split(' · ').slice(1).join('/')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* UNIVERSAL PHENOTYPE TABLE FOR ALL 205 MODELS */}
      <div
        data-testid="proc-all-205-phenotypes-table"
        className="rounded-xl border border-[#26262B] bg-[#121216] p-5"
      >
        <div className="flex flex-col gap-3 border-b border-[#222228] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#EAB308]">
              <Dna className="h-3.5 w-3.5" />
              <span>Универсальные фенотипы · Реестр всех {allSchemas.length} моделей проекта</span>
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F2ED]">
              Таблица фенотипов: модель → эпоха → зоны перекраски → допустимые узоры → варианты
            </h3>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              Каждая из {allSchemas.length} моделей каталога гарантированно генерирует минимум 8 визуально различимых вариантов с сохранением узнаваемости. Нажмите любую строку для живого предпросмотра 8 особей.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8E8E98]" />
              <input
                type="text"
                data-testid="proc-pheno-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по модели или зоне..."
                className="w-56 rounded border border-[#2C2C34] bg-[#18181D] py-1.5 pl-8 pr-2.5 text-xs text-[#F4F2ED] placeholder:text-[#6E6E78] focus:border-[#EAB308] focus:outline-none"
              />
            </div>
            <span className="font-mono text-xs text-[#34D399] tabular-nums">
              {filteredSchemas.length} / {allSchemas.length}
            </span>
          </div>
        </div>

        {/* Era Filters */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ERA_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setEraFilter(tab.id)}
              className={`rounded px-2.5 py-1 text-[11px] cursor-pointer ${
                eraFilter === tab.id
                  ? 'bg-[#EAB308] font-semibold text-[#0B0B0D]'
                  : 'border border-[#24242B] bg-[#17171C] text-[#C4C2BD]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Live 8-Variant Preview Strip of Selected Row */}
        <div className="mt-4 rounded-lg border border-[#24242B] bg-[#16161B] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#F4F2ED]">
              Живой предпросмотр модели: <span className="text-[#EAB308]">{inspectedModel.name}</span>{' '}
              <span className="font-mono text-[11px] font-normal text-[#8E8E98]">({inspectedModel.id})</span>
            </span>
            <span className="font-mono text-[11px] text-[#34D399]">
              Различимых вариантов: {inspectedVariants.length}+ · 0 INK
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {inspectedVariants.map((v) => (
              <div
                key={`${v.modelId}-insp-${v.index}`}
                className="flex flex-col items-center rounded border border-[#25252D] bg-[#1B1B22] p-1.5"
              >
                <div className="flex min-h-[60px] w-full items-center justify-center rounded bg-[#243627] p-1">
                  <PhenoCanvas
                    buffer={v.buffer}
                    scale={inspectedModel.width >= 48 ? 1 : inspectedModel.width >= 26 ? 2 : 3}
                    ariaLabel={`${inspectedModel.name} вариант ${v.index + 1}`}
                  />
                </div>
                <span className="mt-1 w-full truncate text-center text-[9px] text-[#C4C2BD]">
                  {v.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 205-Row Scrollable Registry Table */}
        <div className="mt-4 max-h-[460px] overflow-auto rounded-lg border border-[#24242B]">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#1A1A20] text-[11px] uppercase tracking-wide text-[#8E8E98]">
              <tr className="border-b border-[#26262E]">
                <th className="px-3 py-2.5">Модель</th>
                <th className="px-3 py-2.5">Эпоха</th>
                <th className="px-3 py-2.5">Схема зон перекраски</th>
                <th className="px-3 py-2.5">Допустимые узоры</th>
                <th className="px-3 py-2.5 text-right">Варианты</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F1F26]">
              {filteredSchemas.map((row) => {
                const isSelected = inspectedModelId === row.modelId;
                return (
                  <tr
                    key={row.modelId}
                    onClick={() => setInspectedModelId(row.modelId)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#EAB308]/10' : 'hover:bg-[#18181E]'
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-[#F4F2ED]">
                      <div>{row.modelName}</div>
                      <div className="font-mono text-[10px] text-[#8E8E98]">{row.modelId}</div>
                    </td>
                    <td className="px-3 py-2 text-[#D4D2CD] whitespace-nowrap">{row.eraLabel}</td>
                    <td className="px-3 py-2 text-[#C4C2BD]">{row.zoneScheme}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.allowedPatterns.map((pat) => (
                          <span
                            key={pat}
                            className="rounded border border-[#2B2B34] bg-[#18181E] px-1.5 py-0.5 font-mono text-[10px] text-[#D4D2CD]"
                          >
                            {PATTERN_RU[pat]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[#34D399] tabular-nums">
                      ≥ {row.distinctVariantCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
