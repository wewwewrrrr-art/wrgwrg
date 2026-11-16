import { Check, Code2, Copy, Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BiomeWorldState } from '../engine/biomeSimulation';
import {
  BIOME_HEIGHT,
  BIOME_WIDTH,
  BiomeDefinition,
  GRID_COLS,
  GRID_ROWS,
} from '../models/biomes';
import {
  downloadBiomeCodeJson,
  downloadBiomeCodeTs,
  generateBiomeJson,
  generateStandaloneBiomeTs,
} from '../utils/exportBiomeCode';

interface BiomeCodeModalProps {
  biome: BiomeDefinition | null;
  simState: BiomeWorldState | null;
  onClose: () => void;
}

export function BiomeCodeModal({ biome, simState, onClose }: BiomeCodeModalProps) {
  const [format, setFormat] = useState<'ts' | 'json'>('ts');
  const [sourceMode, setSourceMode] = useState<'live' | 'canonical'>('live');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!biome) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [biome, onClose]);

  const effectiveSim = sourceMode === 'live' ? simState : null;

  const exportedCode = useMemo(() => {
    if (!biome) return '';
    return format === 'ts'
      ? generateStandaloneBiomeTs(biome, effectiveSim)
      : generateBiomeJson(biome, effectiveSim);
  }, [biome, effectiveSim, format]);

  if (!biome) return null;

  const activeCount = effectiveSim
    ? effectiveSim.entities.filter((e) => !e.destroyed).length
    : biome.placements.length;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures in restricted environments
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Код биома ${biome.name}`}
      data-testid="biome-code-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#2C2C34] bg-[#111115] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#24242A] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-[#EAB308]">
              <Code2 className="h-3.5 w-3.5" />
              <span>Экспорт кода 2D-биома · {biome.id}</span>
            </div>
            <h3 className="mt-1 font-display text-xl font-bold text-[#F4F2ED]">
              {biome.name}
            </h3>
            <p className="mt-0.5 text-xs text-[#8E8E98]">
              {BIOME_WIDTH}×{BIOME_HEIGHT} px · сетка {GRID_COLS}×{GRID_ROWS} тайлов · объектов: {activeCount}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно кода биома"
            className="rounded-lg border border-[#26262D] bg-[#17171C] p-2 text-[#A1A1AA] hover:border-[#4A4A54] hover:text-[#F4F2ED] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto p-6">
          <div className="flex flex-col gap-3 border-b border-[#24242A] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Формат экспорта биома"
                className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#18181C] p-1"
              >
                <button
                  type="button"
                  data-testid="biome-format-ts"
                  onClick={() => setFormat('ts')}
                  className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    format === 'ts'
                      ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                      : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                  }`}
                >
                  Автономный TypeScript (.ts)
                </button>
                <button
                  type="button"
                  data-testid="biome-format-json"
                  onClick={() => setFormat('json')}
                  className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    format === 'json'
                      ? 'bg-[#F4F2ED] font-semibold text-[#0B0B0D]'
                      : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                  }`}
                >
                  JSON-карта (.json)
                </button>
              </div>

              <div
                role="group"
                aria-label="Источник состояния карты"
                className="flex items-center gap-1 rounded-lg border border-[#26262B] bg-[#18181C] p-1"
              >
                <button
                  type="button"
                  data-testid="biome-source-live"
                  onClick={() => setSourceMode('live')}
                  className={`rounded-md px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    sourceMode === 'live'
                      ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                      : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                  }`}
                >
                  Текущая карта
                </button>
                <button
                  type="button"
                  data-testid="biome-source-canonical"
                  onClick={() => setSourceMode('canonical')}
                  className={`rounded-md px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    sourceMode === 'canonical'
                      ? 'bg-[#38BDF8] font-semibold text-[#0B0B0D]'
                      : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                  }`}
                >
                  Исходный шаблон
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="biome-copy-code-btn"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E36] bg-[#18181C] px-3 py-1.5 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copied ? (
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
                data-testid="biome-modal-download-ts"
                onClick={() => downloadBiomeCodeTs(biome, effectiveSim)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#EAB308] px-3 py-1.5 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Скачать .ts</span>
              </button>
              <button
                type="button"
                data-testid="biome-modal-download-json"
                onClick={() => downloadBiomeCodeJson(biome, effectiveSim)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E36] bg-[#18181C] px-3 py-1.5 text-xs font-medium text-[#F4F2ED] hover:border-[#4A4A54] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Скачать .json</span>
              </button>
            </div>
          </div>

          <p className="text-xs text-[#8E8E98]">
            {format === 'ts'
              ? `Полностью автономный TypeScript-модуль (${biome.id}.biome.ts): палитра биома, генератор ландшафта classifyProceduralTile(), RLE-матрица 160×90 тайлов, расстановка объектов и готовый renderBiomeBackdrop() / renderToCanvas() без внешних зависимостей.`
              : `Структурированный JSON-снимок (${biome.id}.biome.json): размеры сетки, палитра, RLE-тайлы ландшафта и список всех объектов на карте.`}
          </p>

          <pre
            data-testid="biome-code-preview"
            className="max-h-[52vh] overflow-auto rounded-xl border border-[#26262B] bg-[#0B0B0D] p-5 font-mono text-xs leading-relaxed text-[#E4E2DD]"
          >
            <code>{exportedCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
