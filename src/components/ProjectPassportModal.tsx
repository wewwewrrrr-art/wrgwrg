import { useEffect, useState } from 'react';
import { Check, Copy, Download, FileText, X } from 'lucide-react';
import technicalReferenceMd from '../../docs/TECHNICAL_REFERENCE.md?raw';

export function downloadProjectPassportMd(): void {
  const blob = new Blob([technicalReferenceMd], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bone-forge-passport.md';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ProjectPassportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectPassportModal({ isOpen, onClose }: ProjectPassportModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(technicalReferenceMd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passport-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#2C2C34] bg-[#111114]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#24242A] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2C2C34] bg-[#18181D] text-[#EAB308]">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <h2 id="passport-title" className="font-display text-lg font-bold text-[#F4F2ED]">
                Паспорт проекта «Костяная Кузня»
              </h2>
              <p className="mt-0.5 text-xs text-[#A1A1AA]">
                Полный обзор систем, механик, эпох, рас, анимаций и всех 230 моделей (docs/TECHNICAL_REFERENCE.md)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="passport-copy-btn"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E36] bg-[#18181C] px-3 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] whitespace-nowrap cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#EAB308]" />
                  <span className="text-[#EAB308]">Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Копировать весь текст</span>
                </>
              )}
            </button>
            <button
              type="button"
              data-testid="passport-download-btn"
              onClick={downloadProjectPassportMd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#EAB308] px-3.5 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] whitespace-nowrap cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Скачать .md</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть паспорт"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#26262B] bg-[#18181C] text-[#A1A1AA] hover:border-[#4A4A54] hover:text-[#F4F2ED] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          <pre className="whitespace-pre-wrap rounded-xl border border-[#222228] bg-[#0B0B0D] p-5 font-mono text-xs leading-relaxed text-[#E4E2DD]">
            {technicalReferenceMd}
          </pre>
        </div>
      </div>
    </div>
  );
}
