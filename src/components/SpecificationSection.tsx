import { useState } from 'react';
import { Check, Copy, Download, FileText } from 'lucide-react';
import { downloadProjectPassportMd } from './ProjectPassportModal';

type SpecTabId = 'structures' | 'units' | 'nature' | 'aquatic';

const STRUCTURE_TEMPLATE = `// Часть I. Генерация постройки без чёрного контура (buf.layer + 4 тона)
function renderStructure(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(58, 60);
  drawGroundPlinth(buf, 29, 52, 22, 5.5, RAMPS.slate, RAMPS.obsidian);

  // Каждый узел изолируется в buf.layer(): граница отделяется тёмным тоном материала, без INK
  buf.layer((sub) => {
    drawCylindricalTower(sub, 12, 27, 5, 24, RAMPS.marble, RAMPS.gold);
    drawCrenellations(sub, 7, 25, 11, RAMPS.marble);
  });
  buf.layer((sub) => drawMasonryBox(sub, 17, 20, 24, 31, RAMPS.marble, 5, true));
  drawShingledRoof(buf, 29, 8, 14, 13, RAMPS.magenta, RAMPS.gold, true); // K1_MASK
  return buf;
}`;

const UNIT_TEMPLATE = `// Часть II. Существо с эпохой, генами и запеканием в спрайт-атлас
function renderEraCreature(frame: number, total: number, ctx: RenderContextOptions): PixelBuffer {
  const genes = resolveCreatureGenes(ctx.genes); // size, coat, appendages, biomeTint
  const buf = new PixelBuffer(44, 34);
  // 1. Свет сверху-слева (-1, -1): 4 тона материала, без чёрной обводки
  // 2. Ходьба 2–4 фазы с подпрыгиванием тела на 1 px; плавание — только верхняя часть
  // 3. Попона/одежда на маске K1/K2 -> перекрашивается и запекается в BakedSpriteAtlas
  return applyCreatureGenes(buf, genes, ctx);
}`;

const NATURE_WEATHER_TEMPLATE = `// Часть III. Природа, вещества и полупрозрачная погода (#RRGGBBAA)
function renderStormEffect(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(56, 48); // supportsShadow: false, noOutlineRequired: true
  const t = (frame / total) * Math.PI * 2;
  // Объёмная грозовая туча без чёрного контура + альфа-дымка и полосы дождя
  buf.fillEllipse(28, 14, 15, 7, (nx, ny) => (ny < -0.2 ? RAMPS.slate.mid : RAMPS.obsidian.deep));
  for (let i = 0; i < 16; i++) {
    const rx = 10 + ((i * 7 + frame * 3) % 36);
    const ry = 22 + ((i * 5 + frame * 6) % 18);
    buf.drawLine(rx, ry, rx - 2, ry + 4, '#78BCE0AA', 1); // #RRGGBBAA полупрозрачность
  }
  if (frame % 6 === 2) drawLightningBolt(buf, 28, 18, 24 + Math.sin(t) * 4, 44, '#FFF6A8DD');
  return buf;
}`;

const AQUATIC_TEMPLATE = `// Часть IV. Водный ящер/хищник (WATER_LINE + только верхняя часть тела)
function renderAquaticPredator(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(56, 38); // supportsShadow: false
  const p = frame / total;
  const isAtk = ctx?.unitAction === 'attack';

  // При плавании видна только верхняя часть корпуса над волной, без чёрной обводки
  const lungeX = isAtk ? (p < 0.3 ? Math.round((p / 0.3) * 4) : p < 0.6 ? -6 : 0) : 0;
  buf.layer((sub) => {
    for (let i = 0; i < 18; i++) {
      const y = 20 + Math.round(Math.sin(p * Math.PI * 2 - i * 0.38) * (1.2 + i * 0.14));
      sub.fillEllipse(34 + lungeX + i, y, 1.5, Math.max(1.2, 4.2 - i * 0.17), RAMPS.pine.mid);
    }
    drawHingedJaw(sub, 14 + lungeX, 20, isAtk && p < 0.55 ? 6 : 1);
  });

  drawWaterSurface(buf, 26, frame, total); // волна #D1E3EB/#D5E2EA
  return finalizeAquaticAction(buf, frame, total, ctx?.unitAction ?? 'normal');
}`;

const SPEC_CONTENT: Record<
  SpecTabId,
  {
    tabLabel: string;
    codeTitle: string;
    invariant: string;
    template: string;
    steps: { index: string; title: string; detail: string }[];
  }
> = {
  structures: {
    tabLabel: 'I. Без контура и масштаб',
    codeTitle: 'Эталон сборки без чёрного контура (TypeScript)',
    invariant: 'Инвариант: countInkPixels === 0 && materialToneShading',
    template: STRUCTURE_TEMPLATE,
    steps: [
      {
        index: '01',
        title: 'Свет (-1, -1) и 4 тона без чёрной обводки',
        detail:
          'Никаких чёрных линий #131110 по контуру. Каждый материал имеет 4 тона (блик, свет, основной, тень), а перекрытия узлов в buf.layer() отделяются тёмным оттенком собственного материала.',
      },
      {
        index: '02',
        title: 'Единый масштаб существ и 6–8 цветов',
        detail:
          'Люди ~10×10 px (голова 3–4 px), мелкие звери 6–16 px, крупные звери 20–40 px, гиганты 60–120 px. Экономия палитры: ~6–8 основных цветов на кадр, без одиночных «пикселей-сирот».',
      },
      {
        index: '03',
        title: 'Запекание в спрайт-атлас (BakedSpriteAtlas)',
        detail:
          'Кадры с перекраской масок и генами подвида генерируются один раз в общий атлас-кэш и выводятся через drawImage — движок тянет десятки тысяч существ.',
      },
    ],
  },
  units: {
    tabLabel: 'II. Эпохи, гены и маски',
    codeTitle: 'Эталон существа эпохи с генами подвида (TypeScript)',
    invariant: 'Инвариант: idle/walk/attack/death && CreatureGenes && K1/K2',
    template: UNIT_TEMPLATE,
    steps: [
      {
        index: '01',
        title: '6 исторических эпох и фильтр галереи',
        detail:
          'Первобытная жизнь → Динозавры → Кайнозой и Ледниковье → Каменный век → Бронза/железо → Средневековье, плюс «Дикая природа», «Общая природа» и «Мифические».',
      },
      {
        index: '02',
        title: 'Параметры «генов» подвидов (CreatureGenes)',
        detail:
          'Размер (compact/standard/colossal), окрас (natural/dark/albino/striped), рога/шипы/перья (none/standard/ornate) и окрас под биом (forest/tundra/desert/volcanic).',
      },
      {
        index: '03',
        title: 'Ходьба с подпрыгиванием и маски державы',
        detail:
          'Ходьба 2–4 фазы с вертикальным подпрыгиванием тела на 1 px; одежда, попоны и плюмажи на масках K1/K2 динамически перекрашиваются в цвет державы.',
      },
    ],
  },
  nature: {
    tabLabel: 'III. Природа и погода',
    codeTitle: 'Эталон природы, веществ и полупрозрачной погоды (TypeScript)',
    invariant: 'Инвариант: supportsShadow=false && semitransparentPixels > 0 (для VFX)',
    template: NATURE_WEATHER_TEMPLATE,
    steps: [
      {
        index: '01',
        title: 'Деревья и кусты (ветер без дёргания)',
        detail:
          'Корни и ствол фиксированы в земле, а ярусы листвы качаются с разным фазовым сдвигом без рваных пикселей-сирот.',
      },
      {
        index: '02',
        title: 'Фактурные вещества и породы',
        detail:
          'Внутри fillEllipse/fillPolygon используются целочисленные хэши и 4-тональные рампы для кристаллов, базальта, малахита, магмы и мёда.',
      },
      {
        index: '03',
        title: 'Погода и альфа-канал #RRGGBBAA',
        detail:
          'Дождь, гроза, туман и вихри объявляют supportsShadow: false и noOutlineRequired: true, комбинируя полупрозрачную дымку и острые вспышки.',
      },
    ],
  },
  aquatic: {
    tabLabel: 'IV. Вода и морские ящеры',
    codeTitle: 'Эталон водного хищника и плавания (TypeScript)',
    invariant: 'Инвариант: WATER_LINE + верхняя часть корпуса + 3-фазный attack',
    template: AQUATIC_TEMPLATE,
    steps: [
      {
        index: '01',
        title: 'Плавание: видна только верхняя часть',
        detail:
          'При нахождении в воде нижняя часть тела уходит под волну WATER_LINE (#D1E3EB/#D5E2EA), остаётся только спина, шея, плавник или голова.',
      },
      {
        index: '02',
        title: 'Бегущая волна позвоночника и ласты',
        detail:
          'Змеи и морские ящеры (плезиозавры, мозазавры) изгибают сегменты по фазе sin(t - i * freq) без чёрных контурных полос.',
      },
      {
        index: '03',
        title: 'Уникальные 3-фазные атаки',
        detail:
          'Замах → Удар/Выпад/Всплеск → Возврат, а также отдельные состояния idle, walk, attack, death.',
      },
    ],
  },
};

const PITFALLS = [
  {
    mistake: 'Чёрная 1px обводка #131110 вокруг спрайта или частей тела',
    impact: 'Убивает читаемость на 10–30 px масштабе и противоречит стилю «Костяной Кузни»',
    fix: 'Разделять детали более тёмным оттенком собственного материала и светом (-1, -1)',
  },
  {
    mistake: 'Шум, дитеринг и одиночные «пиксели-сироты»',
    impact: 'Силуэт становится грязным, а на кадр расходуется > 20 лишних цветов',
    fix: 'Держать ~6–8 чистых цветов на кадр, группируя блики и тени цельными кластерами',
  },
  {
    mistake: 'Рисование каждого кадра заново без кэширования атласа',
    impact: 'Падение FPS при спавне сотен и тысяч существ на карте биома',
    fix: 'Использовать BakedSpriteAtlas (сгенерировать один раз -> блит из кэша страниц)',
  },
  {
    mistake: 'Перекраска масок или теней без учёта stageBg и генов в ключе',
    impact: 'Смешение вариантов подвидов или устаревший оттенок тени при смене фона',
    fix: 'Включать modelId | kingdom | phenotype | genes | mode | action | shadowStage | frame в ключ',
  },
];

export function SpecificationSection() {
  const [specTab, setSpecTab] = useState<SpecTabId>('structures');
  const [copied, setCopied] = useState(false);

  const activeSpec = SPEC_CONTENT[specTab];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeSpec.template);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <section id="spec" className="border-t border-[#26262B] bg-[#0E0E11]">
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        <div className="flex flex-col gap-6 border-b border-[#222228] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-wide text-[#EAB308]">
              Технический документ · SPECIFICATION.md
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#F4F2ED]">
              Формальная спецификация «Костяной Кузни»
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
              Собственный процедурный стиль без чёрных контуров: свет сверху-слева (-1, -1), 4 тона материала,
              эпохи, гены подвидов и запекание в спрайт-атлас.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-testid="spec-download-passport-btn"
                onClick={downloadProjectPassportMd}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#EAB308] px-3.5 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-[#FACC15] transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Скачать паспорт проекта (.md)</span>
              </button>
              <a
                href="#passport-footer"
                onClick={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent('open-project-passport'));
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E36] bg-[#18181C] px-3.5 py-2 text-xs font-medium text-[#F4F2ED] hover:border-[#EAB308] transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-[#EAB308]" />
                <span>Читать и скопировать текст</span>
              </a>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Разделы спецификации"
            className="flex flex-wrap items-center gap-1 rounded-xl border border-[#26262B] bg-[#131316] p-1 self-start lg:self-auto"
          >
            {(Object.keys(SPEC_CONTENT) as SpecTabId[]).map((tabId) => (
              <button
                key={tabId}
                type="button"
                role="tab"
                data-testid={`spec-tab-${tabId}`}
                aria-selected={specTab === tabId}
                onClick={() => setSpecTab(tabId)}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  specTab === tabId
                    ? 'bg-[#F4F2ED] text-[#0B0B0D]'
                    : 'text-[#A1A1AA] hover:text-[#F4F2ED]'
                }`}
              >
                {SPEC_CONTENT[tabId].tabLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-5">
            {activeSpec.steps.map((step) => (
              <div key={step.index} className="border-b border-[#222228] pb-5 last:border-b-0">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs font-semibold text-[#EAB308] tabular-nums">
                    {step.index}
                  </span>
                  <h3 className="font-display text-base font-semibold text-[#F4F2ED]">
                    {step.title}
                  </h3>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#A1A1AA]">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>

          <div className="lg:col-span-7">
            <div className="flex h-full flex-col justify-between rounded-2xl border border-[#26262B] bg-[#131316] p-6">
              <div className="flex items-center justify-between gap-4 border-b border-[#222228] pb-4">
                <div>
                  <div className="font-display text-sm font-semibold text-[#F4F2ED]">
                    {activeSpec.codeTitle}
                  </div>
                  <div className="mt-0.5 text-xs text-[#8E8E98]">
                    {activeSpec.invariant}
                  </div>
                </div>
                <button
                  type="button"
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
                      <span>Копировать шаблон</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="mt-4 overflow-x-auto rounded-xl border border-[#222228] bg-[#0B0B0D] p-5 font-mono text-xs leading-relaxed text-[#E4E2DD]">
                <code>{activeSpec.template}</code>
              </pre>

              <div className="mt-4 grid grid-cols-3 gap-4 border-t border-[#222228] pt-4 text-xs text-[#8E8E98]">
                <div>
                  <div className="font-mono text-[#F4F2ED]">spriteAtlas.ts</div>
                  <div className="mt-0.5">Запекание страниц атласа и кэш</div>
                </div>
                <div>
                  <div className="font-mono text-[#F4F2ED]">pixelSandboxStyle.ts</div>
                  <div className="mt-0.5">Тональные швы и падающие тени</div>
                </div>
                <div>
                  <div className="font-mono text-[#F4F2ED]">pixelCanvas.test.ts</div>
                  <div className="mt-0.5">Автотесты эпох, генов и безконтурности</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Pre-Flight Anti-Pattern Matrix */}
        <div className="mt-10 overflow-hidden rounded-2xl border border-[#26262B] bg-[#131316]">
          <div className="border-b border-[#222228] px-6 py-4">
            <h3 className="font-display text-base font-semibold text-[#F4F2ED]">
              Чек-лист типичных ошибок и правила стиля
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#222228] bg-[#16161A] text-[#8E8E98]">
                <tr>
                  <th className="px-6 py-3 font-medium">Ошибка</th>
                  <th className="px-6 py-3 font-medium">Последствие</th>
                  <th className="px-6 py-3 font-medium">Правило исправления</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222228] text-[#D4D2CD]">
                {PITFALLS.map((row) => (
                  <tr key={row.mistake}>
                    <td className="px-6 py-3 font-medium text-[#F4F2ED]">{row.mistake}</td>
                    <td className="px-6 py-3 text-[#A1A1AA]">{row.impact}</td>
                    <td className="px-6 py-3 text-[#EAB308]">{row.fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
