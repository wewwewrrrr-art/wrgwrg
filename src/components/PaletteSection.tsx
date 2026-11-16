import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  KINGDOM_PRESETS,
  PALETTE_GROUPS,
  SKIN_MASK,
  SKIN_PHENOTYPES,
  calculateKingdomRamp,
  calculateSkinShades,
} from '../engine/palette';

export function PaletteSection() {
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  const handleCopyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 1500);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  };

  return (
    <section id="palette" className="border-t border-[#26262B] bg-[#0B0B0D]">
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-bold tracking-tight text-[#F4F2ED]">
            Рампы материалов и формулы перекраски
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
            4-ступенчатые рампы материалов для архитектуры и точные каналы масок{' '}
            <code className="text-[#F4F2ED]">K1</code>, <code className="text-[#F4F2ED]">K2</code>,{' '}
            <code className="text-[#F4F2ED]">SKIN_MASK</code> из спецификации «Костяной Кузни».
          </p>
        </div>

        {/* 4-stop Material Ramps */}
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PALETTE_GROUPS.map((ramp) => {
            const stops = [
              { label: 'Deep', hex: ramp.deep },
              { label: 'Shadow', hex: ramp.shadow },
              { label: 'Mid', hex: ramp.mid },
              { label: 'Light', hex: ramp.highlight },
            ];
            return (
              <div
                key={ramp.id}
                className="rounded-2xl border border-[#26262B] bg-[#131316] p-5"
              >
                <h3 className="font-display text-base font-semibold text-[#F4F2ED]">
                  {ramp.name}
                </h3>
                <p className="mt-1 text-xs text-[#8E8E98]">{ramp.role}</p>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  {stops.map((c) => {
                    const isCopied = copiedHex === c.hex;
                    return (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => handleCopyHex(c.hex)}
                        aria-label={`Скопировать цвет ${c.label} ${c.hex}`}
                        className="group flex flex-col items-start text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#EAB308]"
                      >
                        <div
                          className="h-9 w-full rounded-lg border border-white/10 transition-transform group-hover:scale-[1.03]"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span className="mt-1.5 text-[11px] font-medium text-[#E4E2DD]">
                          {c.label}
                        </span>
                        <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-[#8E8E98]">
                          {isCopied ? (
                            <>
                              <Check className="h-2.5 w-2.5 text-[#EAB308]" />
                              <span className="text-[#EAB308]">OK</span>
                            </>
                          ) : (
                            <>
                              <span>{c.hex}</span>
                              <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Dynamic Mask Recoloring Reference Strips */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#26262B] bg-[#131316] p-6">
            <h3 className="font-display text-base font-semibold text-[#F4F2ED]">
              Расчёт цветов королевства (Lerp к 30,30,30)
            </h3>
            <p className="mt-1 text-xs text-[#8E8E98]">
              Если все каналы &lt; 128, добавляется +50, затем вычисляются 4 ступени затемнения.
            </p>
            <div className="mt-4 space-y-2.5">
              {KINGDOM_PRESETS.filter((k) => k.id !== 'original')
                .slice(0, 6)
                .map((k) => {
                  const ramp = calculateKingdomRamp(k.primaryHex);
                  return (
                    <div key={k.id} className="flex items-center justify-between gap-4 text-xs">
                      <span className="w-24 font-medium text-[#E4E2DD]">{k.name}</span>
                      <div className="flex flex-1 items-center gap-1.5">
                        {ramp.map((hex) => (
                          <div
                            key={hex}
                            className="h-5 flex-1 rounded border border-white/10"
                            style={{ backgroundColor: hex }}
                            title={hex}
                          />
                        ))}
                      </div>
                      <span className="w-16 text-right font-mono text-[11px] text-[#8E8E98] tabular-nums">
                        {k.primaryHex}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="rounded-2xl border border-[#26262B] bg-[#131316] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-[#F4F2ED]">
                  Маска кожи и фенотипы (SKIN_MASK)
                </h3>
                <p className="mt-1 text-xs text-[#8E8E98]">
                  Зелёные пиксели #B8FF96..#4A831F заменяются на 4 оттенка фенотипа [1.0, 0.9, 0.8, 0.7].
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {SKIN_MASK.map((m) => (
                  <div
                    key={m}
                    className="h-4 w-4 rounded border border-white/15"
                    style={{ backgroundColor: m }}
                    title={m}
                  />
                ))}
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              {SKIN_PHENOTYPES.slice(0, 6).map((p) => {
                const shades = calculateSkinShades(p.fromHex, p.toHex, 1);
                return (
                  <div key={p.id} className="flex items-center justify-between gap-4 text-xs">
                    <span className="w-24 font-medium text-[#E4E2DD]">{p.name}</span>
                    <div className="flex flex-1 items-center gap-1.5">
                      {shades.map((hex) => (
                        <div
                          key={hex}
                          className="h-5 flex-1 rounded border border-white/10"
                          style={{ backgroundColor: hex }}
                          title={hex}
                        />
                      ))}
                    </div>
                    <span className="w-28 text-right font-mono text-[10px] text-[#8E8E98] tabular-nums">
                      {p.fromHex}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
