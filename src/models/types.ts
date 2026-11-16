import { PixelBuffer } from '../engine/pixelCanvas';
import { UnitAction, UnitFrameAnchors, UnitMode } from '../engine/unitAssembler';

export type ModelKind =
  | 'static'
  | 'animated'
  | 'unit'
  | 'aquatic'
  | 'nature'
  | 'substance'
  | 'weather';
export type ModelTier = 'I' | 'II' | 'III';

export type EraId =
  | 'primordial'
  | 'dinosaurs'
  | 'ice-age'
  | 'stone-age'
  | 'bronze-iron'
  | 'medieval'
  | 'wildlife'
  | 'common-nature'
  | 'mythic';

export type EntityType = 'creature' | 'unit' | 'building' | 'nature';
export type BuildingState = 'constructing' | 'ready' | 'damaged' | 'ruins';
export type BuildingFunction =
  | 'housing'
  | 'food'
  | 'defense'
  | 'religion'
  | 'production'
  | 'nature';

export type GeneSize = 'compact' | 'standard' | 'colossal';
export type GeneCoat = 'natural' | 'dark' | 'albino' | 'striped';
export type GeneAppendages = 'none' | 'standard' | 'ornate';
export type GeneBiomeTint = 'none' | 'forest' | 'tundra' | 'desert' | 'volcanic';
export type GenePattern = 'solid' | 'striped' | 'spotted' | 'dappled';

export interface CreatureGenes {
  size?: GeneSize;
  coat?: GeneCoat;
  appendages?: GeneAppendages;
  biomeTint?: GeneBiomeTint;
  pattern?: GenePattern;
}

export const TIER_LABELS: Record<ModelTier, string> = {
  I: 'Ур. I · Базовый',
  II: 'Ур. II · Развитый',
  III: 'Ур. III · Элита',
};

export type FactionName =
  | 'Некрополь'
  | 'Цитадель'
  | 'Лесной Круг'
  | 'Бастион Мороза'
  | 'Кузня Пекла'
  | 'Гильдия'
  | 'Орда';

export type StageBg = 'dark' | 'checker' | 'meadow' | 'ocean' | 'parchment';

export interface RenderContextOptions {
  kingdomId?: string;
  phenotypeId?: string;
  unitMode?: UnitMode;
  unitAction?: UnitAction;
  showShadow?: boolean;
  stageBg?: StageBg;
  genes?: CreatureGenes;
  buildingState?: BuildingState;
}

export interface UnitMetadata {
  readonly coreSize: string;
  readonly usesSkinMask: boolean;
  readonly defaultPhenotype?: string;
  readonly supportsSwim: boolean;
  readonly supportsActions: boolean;
  readonly shadowWidth: number;
  readonly supportsGenes?: boolean;
}

export interface PixelModelDef {
  id: string;
  name: string;
  subtitle: string;
  kind: ModelKind;
  tier: ModelTier;
  era?: EraId;
  entityType?: EntityType;
  buildingFunction?: BuildingFunction;
  supportsBuildingStates?: boolean;
  faction: FactionName;
  width: number;
  height: number;
  frameCount: number;
  defaultFps: number;
  layersSpec: string[];
  description: string;
  /** Signature unique attack label (primarily for aquatic monsters & bosses) */
  attackName?: string;
  unitMeta?: UnitMetadata;
  /** True for atmospheric weather/clouds/fog/VFX without ground-contact edges */
  noOutlineRequired?: boolean;
  /** False for airborne/sky weather/VFX that have no ground cast shadow */
  supportsShadow?: boolean;
  renderFrame: (
    frameIndex: number,
    totalFrames: number,
    ctx?: RenderContextOptions
  ) => PixelBuffer;
  getAnchors?: (
    frameIndex: number,
    totalFrames: number,
    ctx?: RenderContextOptions
  ) => UnitFrameAnchors | null;
  codeSnippet: string;
}
