import { PixelModelDef } from '../models/types';
import { PixelSpriteCanvas } from './PixelSpriteCanvas';

interface HeroSectionProps {
  featuredModels: PixelModelDef[];
  totalModels: number;
  isPlaying: boolean;
  speedMultiplier: number;
  kingdomId: string;
  showShadow: boolean;
  onInspectModel: (model: PixelModelDef) => void;
  onOpenReference: () => void;
}

const KIND_LABELS: Record<PixelModelDef['kind'], string> = {
  aquatic: 'Водный монстр',
  animated: 'Механизм',
  static: 'Постройка',
  unit: 'Существо',
  nature: 'Природа',
  substance: 'Вещество',
  weather: 'Погода и VFX',
};

export function HeroSection({
  featuredModels,
  totalModels,
  isPlaying,
  speedMultiplier,
  kingdomId,
  showShadow,
  onInspectModel,
  onOpenReference,
}: HeroSectionProps) {
  return (
    <section id="top" className="border-b border-[#26262B] bg-[#0B0B0D]">
      <div className="mx-auto max-w-[1280px] px-6 py-12 lg:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-stretch">
          <div className="flex flex-col justify-center lg:col-span-6">
            <p className="text-xs font-medium tracking-wide text-[#EAB308]">
              Формальная пиксельная грамматика · Мир, существа, океан и эффекты
            </p>
            <h1 className="mt-3 max-w-xl font-display text-4xl font-bold tracking-tight text-[#F4F2ED] sm:text-5xl [text-wrap:balance]">
              Процедурный пиксель-арт и перекраска масок в коде
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-[#A1A1AA]">
              {totalModels} процедурных моделей: доисторические и мифические водные монстры с уникальными
              атаками (Мозазавр, Левиафан, Кракен, Мегалодон, Дунклеостей и др.), природа, вещества, погода,
              постройки и юниты с экспортом в <code className="text-[#F4F2ED]">.ts / .json</code>.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href="#gallery"
                className="rounded-lg bg-[#EAB308] px-5 py-2.5 text-sm font-semibold text-[#0B0B0D] hover:bg-[#FACC15] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EAB308]"
              >
                Открыть модели
              </a>
              <a
                href="#spec"
                className="rounded-lg border border-[#2E2E34] bg-[#141417] px-5 py-2.5 text-sm font-medium text-[#F4F2ED] hover:border-[#4A4A54] hover:bg-[#1B1B20] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
              >
                Спецификация для агентов
              </a>
              <button
                type="button"
                onClick={onOpenReference}
                className="px-2 py-2 text-sm font-medium text-[#A1A1AA] hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Эталоны →
              </button>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="flex h-full flex-col justify-between rounded-2xl border border-[#26262B] bg-[#131316] p-6">
              <div className="flex items-center justify-between border-b border-[#222228] pb-3 text-xs text-[#A1A1AA]">
                <span>Срез: тираннозавр, монарх, механизм и кракен</span>
                <span className="font-mono tabular-nums">1:1 пиксель-сетка</span>
              </div>

              <div className="my-6 grid grid-cols-2 gap-4">
                {featuredModels.map((model) => {
                  const kindLabel = KIND_LABELS[model.kind];
                  const stageScale =
                    model.kind === 'unit'
                      ? model.width <= 34
                        ? 4
                        : 3
                      : model.width <= 54
                        ? 2
                        : 2;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => onInspectModel(model)}
                      className="group flex flex-col items-center justify-center rounded-xl border border-[#232329] bg-[#1A1A1F] p-4 transition-colors hover:border-[#EAB308]/60 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
                    >
                      <div className="flex h-36 items-center justify-center">
                        <PixelSpriteCanvas
                          model={model}
                          scale={stageScale}
                          isPlaying={isPlaying}
                          speedMultiplier={speedMultiplier}
                          kingdomId={kingdomId}
                          showShadow={showShadow}
                          stageBg="dark"
                        />
                      </div>
                      <span className="mt-2 text-xs font-medium text-[#E4E2DD] group-hover:text-[#EAB308] transition-colors">
                        {model.name}
                      </span>
                      <span className="mt-0.5 text-[11px] text-[#8E8E98]">
                        {kindLabel} · Ур. {model.tier} · {model.faction}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between text-xs text-[#8E8E98]">
                <span>Нажмите на любую модель для разбора слоёв, теней и экспорта кода</span>
                <span className="font-mono tabular-nums">4 / {totalModels} на витрине</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-6 border-t border-[#222227] pt-8 md:grid-cols-4">
          <div>
            <div className="font-mono text-2xl font-semibold text-[#F4F2ED] tabular-nums">
              {totalModels} моделей
            </div>
            <div className="mt-1 text-xs text-[#8E8E98]">
              Водные хищники, природа, вещества, погода, постройки и юниты
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[#F4F2ED] tabular-nums">
              buf.layer()
            </div>
            <div className="mt-1 text-xs text-[#8E8E98]">
              Тональные швы без чёрного контура и альфа-слои α
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[#F4F2ED] tabular-nums">
              K1 / K2 / Skin
            </div>
            <div className="mt-1 text-xs text-[#8E8E98]">
              Живая перекраска королевств и фенотипов с кэшем
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[#F4F2ED] tabular-nums">
              Без артефактов
            </div>
            <div className="mt-1 text-xs text-[#8E8E98]">
              Чистое наложение теней и автотесты всех инвариантов
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
