import { useEffect } from 'react';
import { X } from 'lucide-react';
import { ALL_MODELS } from '../models';
import { PixelSpriteCanvas } from './PixelSpriteCanvas';

interface ReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const REFERENCE_SHOWCASE_IDS = [
  {
    id: 'citadel-keep',
    title: '1. Постройка без чёрного контура (buf.layer + 4 тона)',
    note: 'Узлы изолированы тёмным тоном собственного материала (#586074 -> #383E4C) и светом (-1, -1).',
  },
  {
    id: 'tyrannosaurus-rex',
    title: '2. Крупный зверь (68×52 px, гены и K1/K2)',
    note: 'Без чёрной обводки: читаемость силуэта через 4-тональную пластику мышц и хвоста.',
  },
  {
    id: 'paladin-knight',
    title: '3. Пеший юнит (~10–14 px ядро, 4-кадровая походка)',
    note: 'Крошечный масштаб с подпрыгиванием тела на 1 px и перекрашиваемой туникой K1/K2.',
  },
  {
    id: 'kraken',
    title: '4. Водный хищник (WATER_LINE и верхняя часть тела)',
    note: 'Часть корпуса скрыта под волной, анимация гребков и мягкая палитра без контурной грязи.',
  },
] as const;

export function ReferenceModal({ isOpen, onClose }: ReferenceModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reference-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#2C2C34] bg-[#111114]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#24242A] px-6 py-4">
          <div>
            <h2 id="reference-title" className="font-display text-xl font-bold text-[#F4F2ED]">
              Эталоны стиля «Костяной Кузни» (собственная графика)
            </h2>
            <p className="mt-0.5 text-xs text-[#A1A1AA]">
              Процедурные примеры без чёрного контура, со светом (-1, -1) и запечёнными масками K1/K2
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть эталон"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#26262B] bg-[#18181C] text-[#A1A1AA] hover:border-[#4A4A54] hover:text-[#F4F2ED] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {REFERENCE_SHOWCASE_IDS.map((entry) => {
              const model = ALL_MODELS.find((m) => m.id === entry.id) ?? ALL_MODELS[0];
              const scale = model.width <= 32 ? 4 : model.width <= 54 ? 3 : 2;
              return (
                <div
                  key={entry.id}
                  className="flex flex-col justify-between rounded-xl border border-[#26262B] bg-[#16161B] p-4"
                >
                  <div className="text-xs font-semibold text-[#F4F2ED]">{entry.title}</div>
                  <div className="my-4 flex h-40 items-center justify-center rounded-lg border border-[#222228] bg-[#1B1B20]">
                    <PixelSpriteCanvas
                      model={model}
                      scale={scale}
                      isPlaying={model.frameCount > 1}
                      kingdomId="red"
                      showShadow
                      stageBg="dark"
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-[#A1A1AA]">{entry.note}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs text-[#A1A1AA]">
            <div className="rounded-xl border border-[#24242A] bg-[#16161A] p-4">
              <div className="font-semibold text-[#F4F2ED]">Без чёрного контура</div>
              <p className="mt-1.5 leading-relaxed">
                Никаких обводок #131110: части тела и архитектуры отделяются тёмным тоном своего же материала и светом (-1, -1).
              </p>
            </div>
            <div className="rounded-xl border border-[#24242A] bg-[#16161A] p-4">
              <div className="font-semibold text-[#F4F2ED]">4 тона и маски державы</div>
              <p className="mt-1.5 leading-relaxed">
                Одежда, попоны и знамёна используют K1/K2/SKIN, перекрашиваясь под любую державу за O(1).
              </p>
            </div>
            <div className="rounded-xl border border-[#24242A] bg-[#16161A] p-4">
              <div className="font-semibold text-[#F4F2ED]">Собственный спрайт-атлас</div>
              <p className="mt-1.5 leading-relaxed">
                Готовые кадры запекаются в атлас один раз и далее отрисовываются из кэша для десятков тысяч существ.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
