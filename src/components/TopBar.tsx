import { FilterTab } from '../models';

interface TopBarProps {
  onOpenReference: () => void;
  onExportAtlas: () => void;
  onExportAll?: () => void;
  onSelectFilter: (filter: FilterTab) => void;
}

export function TopBar({
  onOpenReference,
  onExportAtlas,
  onExportAll,
  onSelectFilter,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#26262B] bg-[#0B0B0D]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
        <a
          href="#top"
          className="font-display text-lg font-semibold tracking-tight text-[#F4F2ED] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
        >
          Костяная Кузня
        </a>

        <nav
          aria-label="Основная навигация"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#A1A1AA]"
        >
          <a
            href="#biome"
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Биом
          </a>
          <a
            href="#procedural-units"
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Генератор 10×10
          </a>
          <a
            href="#animations"
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Анимации
          </a>
          <a
            href="#humans"
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Эталон людей
          </a>
          <a
            href="#gallery"
            onClick={() => onSelectFilter('all')}
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Модели
          </a>
          <a
            href="#spec"
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Спецификация
          </a>
          <a
            href="#palette"
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Палитра
          </a>
          <button
            type="button"
            onClick={onOpenReference}
            className="hover:text-[#F4F2ED] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
          >
            Эталон
          </button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onExportAtlas}
            className="rounded-lg border border-[#2C2C34] bg-[#18181D] px-3 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EAB308]"
          >
            Экспорт атласа
          </button>
          {onExportAll && (
            <button
              type="button"
              data-testid="topbar-export-all-btn"
              onClick={onExportAll}
              className="rounded-lg bg-[#EAB308] px-3.5 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EAB308]"
            >
              Экспорт всего
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
