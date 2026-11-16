import { useEffect, useMemo, useState } from 'react';
import { BiomePreviewSection } from './components/BiomePreviewSection';
import { HeroSection } from './components/HeroSection';
import { HumanDiversitySection } from './components/HumanDiversitySection';
import { ProceduralUnitForgeSection } from './components/ProceduralUnitForgeSection';
import { AnimationsAndVillageSection } from './components/AnimationsAndVillageSection';
import { InspectorModal } from './components/InspectorModal';
import { ModelGallery } from './components/ModelGallery';
import { PaletteSection } from './components/PaletteSection';
import { ProjectPassportModal, downloadProjectPassportMd } from './components/ProjectPassportModal';
import { ReferenceModal } from './components/ReferenceModal';
import { SpecificationSection } from './components/SpecificationSection';
import { TopBar } from './components/TopBar';
import {
  ALL_MODELS,
  EntityTypeFilter,
  EraFilter,
  FilterTab,
  TierFilter,
  filterModels,
} from './models';
import { BuildingState, PixelModelDef, StageBg } from './models/types';
import { downloadFullAtlasPng } from './utils/exportPng';
import { triggerFullExportZipDownload } from './engine/forgeApi';

export type GalleryStageBg = StageBg;

export default function App() {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityTypeFilter>('all');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [eraFilter, setEraFilter] = useState<EraFilter>('all');
  const [isPlaying, setIsPlaying] = useState<boolean>(!prefersReducedMotion);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [cardScale, setCardScale] = useState<number>(3);
  const [kingdomId, setKingdomId] = useState<string>('original');
  const [showShadow, setShowShadow] = useState<boolean>(true);
  const [stageBg, setStageBg] = useState<GalleryStageBg>('dark');
  const [galleryAction, setGalleryAction] = useState<'idle' | 'normal' | 'attack'>('normal');
  const [galleryBuildingState, setGalleryBuildingState] = useState<BuildingState>('ready');
  const [inspectedModel, setInspectedModel] = useState<PixelModelDef | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'preview' | 'code'>('preview');
  const [isReferenceOpen, setIsReferenceOpen] = useState<boolean>(false);
  const [isPassportOpen, setIsPassportOpen] = useState<boolean>(false);

  useEffect(() => {
    const handler = () => setIsPassportOpen(true);
    window.addEventListener('open-project-passport', handler);
    return () => window.removeEventListener('open-project-passport', handler);
  }, []);

  const handleInspectModel = (
    model: PixelModelDef,
    initialTab: 'preview' | 'code' = 'preview'
  ) => {
    setInspectorTab(initialTab);
    setInspectedModel(model);
  };

  const handleStageBgChange = (nextBg: GalleryStageBg) => {
    setStageBg(nextBg);
  };

  const visibleModels = useMemo(
    () => filterModels(ALL_MODELS, activeFilter, tierFilter, eraFilter, entityTypeFilter),
    [activeFilter, tierFilter, eraFilter, entityTypeFilter]
  );

  // Showcase breadth: Tyrannosaurus rex, Alliance Monarch, animated mechanism, and kraken boss
  const featuredModels = useMemo(() => {
    const byId = (id: string) => ALL_MODELS.find((m) => m.id === id) ?? ALL_MODELS[0];
    return [
      byId('tyrannosaurus-rex'),
      byId('alliance-monarch'),
      byId('hellfire-portal'),
      byId('kraken'),
    ];
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-[#F4F2ED]">
      <TopBar
        onOpenReference={() => setIsReferenceOpen(true)}
        onExportAtlas={() => downloadFullAtlasPng(ALL_MODELS, 4, { kingdomId, showShadow, stageBg })}
        onExportAll={() => triggerFullExportZipDownload(1)}
        onSelectFilter={(f) => {
          setActiveFilter(f);
          setEntityTypeFilter('all');
          setTierFilter('all');
          setEraFilter('all');
        }}
      />

      <main>
        <HeroSection
          featuredModels={featuredModels}
          totalModels={ALL_MODELS.length}
          isPlaying={isPlaying}
          speedMultiplier={speedMultiplier}
          kingdomId={kingdomId}
          showShadow={showShadow}
          onInspectModel={(m) => handleInspectModel(m, 'preview')}
          onOpenReference={() => setIsReferenceOpen(true)}
        />

        <BiomePreviewSection
          allModels={ALL_MODELS}
          kingdomId={kingdomId}
          isPlaying={isPlaying}
          onTogglePlaying={() => setIsPlaying((p) => !p)}
          speedMultiplier={speedMultiplier}
          showShadow={showShadow}
          onInspectModel={handleInspectModel}
        />

        <ProceduralUnitForgeSection onInspectModel={handleInspectModel} />

        <AnimationsAndVillageSection />

        <HumanDiversitySection />

        <ModelGallery
          models={visibleModels}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          entityTypeFilter={entityTypeFilter}
          onEntityTypeFilterChange={setEntityTypeFilter}
          tierFilter={tierFilter}
          onTierFilterChange={setTierFilter}
          eraFilter={eraFilter}
          onEraFilterChange={setEraFilter}
          isPlaying={isPlaying}
          onTogglePlaying={() => setIsPlaying((p) => !p)}
          speedMultiplier={speedMultiplier}
          onSpeedChange={setSpeedMultiplier}
          cardScale={cardScale}
          onCardScaleChange={setCardScale}
          kingdomId={kingdomId}
          onKingdomChange={setKingdomId}
          showShadow={showShadow}
          onToggleShadow={() => setShowShadow((s) => !s)}
          stageBg={stageBg}
          onStageBgChange={handleStageBgChange}
          galleryAction={galleryAction}
          onGalleryActionChange={setGalleryAction}
          buildingState={galleryBuildingState}
          onBuildingStateChange={setGalleryBuildingState}
          onInspectModel={handleInspectModel}
        />

        <SpecificationSection />

        <PaletteSection />
      </main>

      <footer id="passport-footer" className="border-t border-[#26262B] bg-[#0B0B0D]">
        <div className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-6 py-8 text-xs text-[#8E8E98] sm:flex-row sm:items-center">
          <span>Костяная Кузня — формальная спецификация и генератор RTS-структур, природы, погоды и водных монстров</span>
          <div className="flex flex-wrap items-center gap-6">
            <button
              type="button"
              data-testid="footer-open-passport-btn"
              onClick={() => setIsPassportOpen(true)}
              className="text-[#EAB308] hover:text-[#FACC15] transition-colors cursor-pointer"
            >
              Читать паспорт проекта
            </button>
            <button
              type="button"
              data-testid="footer-download-passport-btn"
              onClick={downloadProjectPassportMd}
              className="hover:text-[#F4F2ED] transition-colors cursor-pointer"
            >
              Скачать паспорт (.md)
            </button>
            <button
              type="button"
              onClick={() => setIsReferenceOpen(true)}
              className="hover:text-[#F4F2ED] transition-colors cursor-pointer"
            >
              Открыть эталоны
            </button>
            <button
              type="button"
              onClick={() => downloadFullAtlasPng(ALL_MODELS, 4, { kingdomId, showShadow, stageBg })}
              className="hover:text-[#F4F2ED] transition-colors cursor-pointer"
            >
              Скачать атлас PNG
            </button>
          </div>
        </div>
      </footer>

      {inspectedModel && (
        <InspectorModal
          key={`${inspectedModel.id}-${inspectorTab}`}
          model={inspectedModel}
          initialTab={inspectorTab}
          kingdomId={kingdomId}
          onKingdomChange={setKingdomId}
          initialShowShadow={showShadow}
          initialStageBg={stageBg}
          initialUnitAction={galleryAction}
          initialBuildingState={galleryBuildingState}
          onClose={() => setInspectedModel(null)}
        />
      )}

      <ReferenceModal
        isOpen={isReferenceOpen}
        onClose={() => setIsReferenceOpen(false)}
      />

      <ProjectPassportModal
        isOpen={isPassportOpen}
        onClose={() => setIsPassportOpen(false)}
      />
    </div>
  );
}
