import { hexToRgba, rgbToHex } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef, StageBg } from './types';

export const BIOME_WIDTH = 640;
export const BIOME_HEIGHT = 360;
export const TILE_SIZE = 4;
export const GRID_COLS = BIOME_WIDTH / TILE_SIZE; // 160
export const GRID_ROWS = BIOME_HEIGHT / TILE_SIZE; // 90

export type BiomeId =
  | 'forest-citadel'
  | 'volcanic-forge'
  | 'frozen-fjord'
  | 'blighted-swamp'
  | 'coastal-oasis';

export type BiomeLayer = 'ground' | 'water' | 'air' | 'sky';

export type TopDownTileType =
  | 'deepWater'
  | 'midWater'
  | 'shallowWater'
  | 'shore'
  | 'grass'
  | 'path'
  | 'accentBiome'
  | 'rock'
  | 'snow';

export interface BiomePlacement {
  id: string;
  modelId: string;
  /** Anchor center-bottom X in logical 640x360 2D map coordinates */
  x: number;
  /** Anchor bottom Y in logical 640x360 2D map coordinates */
  y: number;
  layer: BiomeLayer;
  facing?: -1 | 1;
  /** Horizontal 2D wander amplitude in px */
  patrolSpan?: number;
  /** Vertical 2D wander amplitude in px */
  patrolSpanY?: number;
  patrolSpeed?: number;
  hoverBob?: number;
  phaseOffset?: number;
  unitMode?: 'walk' | 'swim';
  role: string;
}

export interface TopDownBiomePalette {
  deepWater: [string, string];
  midWater: [string, string];
  shallowWater: [string, string];
  shoreRimColor: string;
  shore: [string, string];
  grass: [string, string];
  path: [string, string];
  accentBiome: [string, string];
  rock: [string, string];
  snow: [string, string];
  flowerColors: string[];
  waveColor: string;
  shadowHex: string;
  isLava?: boolean;
  seed: number;
}

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  subtitle: string;
  description: string;
  stageBg: StageBg;
  palette: TopDownBiomePalette;
  weatherIds: string[];
  placements: BiomePlacement[];
}

export interface SteppedEntity {
  placement: BiomePlacement;
  model: PixelModelDef;
  x: number;
  y: number;
  facing: -1 | 1;
  drawX: number;
  drawY: number;
}

export const BIOMES: BiomeDefinition[] = [
  {
    id: 'forest-citadel',
    name: 'Лесная Цитадель',
    subtitle: '2D-континент: лес, осенний биом, горы со снегом и вулкан',
    description:
      'Эталонный 2D-континент: каменистый горный хребет со снежными вершинами и мини-вулканом на западе, густой изумрудный лес в центре, багряно-золотая осенняя роща на востоке, песчаные бухты с неоново-бирюзовой кромкой прибоя и речной монстр в заливе.',
    stageBg: 'meadow',
    palette: {
      deepWater: ['#265CA8', '#2458A1'],
      midWater: ['#3B74BA', '#386FB3'],
      shallowWater: ['#5689C6', '#5284C0'],
      shoreRimColor: '#76C7F0',
      shore: ['#D9C58B', '#CEB980'],
      grass: ['#489B35', '#429130'],
      path: ['#9E8C5C', '#918052'],
      accentBiome: ['#A16025', '#945720'], // Autumn Maple soil
      rock: ['#44454A', '#3B3C40'],
      snow: ['#EBF1F6', '#DCE5ED'],
      flowerColors: ['#F2D352', '#E84D4D', '#D95AD9', '#7AE058'],
      waveColor: '#98D9F5',
      shadowHex: '#0F24064A',
      seed: 101,
    },
    weatherIds: ['weather-cumulus-cloud', 'weather-rain'],
    placements: [
      // Structures spread cleanly across main continent
      { id: 'fc-watchtower', modelId: 'watchtower-t1', x: 186, y: 146, layer: 'ground', role: 'Дозорная башня' },
      { id: 'fc-citadel', modelId: 'citadel-keep', x: 304, y: 144, layer: 'ground', role: 'Цитадель' },
      { id: 'fc-shrine', modelId: 'druid-shrine', x: 432, y: 132, layer: 'ground', role: 'Святилище' },
      { id: 'fc-watermill', modelId: 'guild-watermill', x: 454, y: 218, layer: 'ground', role: 'Водяная мельница' },
      // Hero Nature & Substances
      { id: 'fc-oak-1', modelId: 'ancient-oak', x: 236, y: 122, layer: 'ground', role: 'Вековой дуб' },
      { id: 'fc-sakura', modelId: 'sakura-tree', x: 368, y: 174, layer: 'ground', role: 'Сакура' },
      { id: 'fc-willow', modelId: 'weeping-willow', x: 394, y: 230, layer: 'ground', role: 'Плакучая ива' },
      { id: 'fc-maple', modelId: 'autumn-maple', x: 484, y: 162, layer: 'ground', role: 'Осенний клён' },
      { id: 'fc-berry-1', modelId: 'berry-bush', x: 210, y: 184, layer: 'ground', role: 'Ягодный куст' },
      { id: 'fc-mana-shrub', modelId: 'mana-shrub', x: 266, y: 214, layer: 'ground', role: 'Мана-куст' },
      { id: 'fc-dolmen', modelId: 'mossy-dolmen', x: 486, y: 198, layer: 'ground', role: 'Мшистый дольмен' },
      { id: 'fc-geode', modelId: 'crystal-geode', x: 214, y: 228, layer: 'ground', role: 'Кристальная жеода' },
      { id: 'fc-stone', modelId: 'ore-stone-deposit', x: 168, y: 120, layer: 'ground', role: 'Каменная залежь' },
      { id: 'fc-iron', modelId: 'ore-iron-deposit', x: 344, y: 120, layer: 'ground', role: 'Железная руда' },
      // Patrolling Creatures & Units
      { id: 'fc-monarch', modelId: 'alliance-monarch', x: 298, y: 172, layer: 'ground', patrolSpan: 16, patrolSpanY: 6, patrolSpeed: 0.1, role: 'Монарх Альянса' },
      { id: 'fc-treant', modelId: 'forest-treant', x: 322, y: 216, layer: 'ground', patrolSpan: 18, patrolSpanY: 8, patrolSpeed: 0.08, role: 'Страж рощи' },
      { id: 'fc-paladin', modelId: 'paladin-knight', x: 274, y: 180, layer: 'ground', patrolSpan: 24, patrolSpanY: 10, patrolSpeed: 0.13, phaseOffset: 0.7, role: 'Паладин' },
      { id: 'fc-panther', modelId: 'shadow-panther', x: 188, y: 210, layer: 'ground', patrolSpan: 22, patrolSpanY: 8, patrolSpeed: 0.2, phaseOffset: 1.5, role: 'Теневая пантера' },
      { id: 'fc-wolf', modelId: 'dire-wolf', x: 416, y: 186, layer: 'ground', patrolSpan: 20, patrolSpanY: 8, patrolSpeed: 0.16, phaseOffset: 2.9, role: 'Лютоволк' },
      { id: 'fc-druid', modelId: 'stag-druid', x: 454, y: 158, layer: 'ground', patrolSpan: 12, patrolSpanY: 6, patrolSpeed: 0.1, role: 'Друид' },
      // Overhead
      { id: 'fc-griffon', modelId: 'plague-griffon', x: 320, y: 98, layer: 'air', patrolSpan: 76, patrolSpanY: 20, patrolSpeed: 0.11, hoverBob: 3, role: 'Патруль в воздухе' },
      { id: 'fc-cloud', modelId: 'weather-cumulus-cloud', x: 184, y: 74, layer: 'sky', patrolSpan: 36, patrolSpeed: 0.04, role: 'Облака' },
      { id: 'fc-rain', modelId: 'weather-rain', x: 458, y: 122, layer: 'sky', patrolSpan: 26, patrolSpeed: 0.05, role: 'Дождь' },
      // Aquatic inside southern sea
      { id: 'fc-river', modelId: 'river-monster', x: 310, y: 322, layer: 'water', patrolSpan: 86, patrolSpanY: 5, patrolSpeed: 0.09, role: 'Речной монстр' },
    ],
  },
  {
    id: 'volcanic-forge',
    name: 'Кузня Пекла',
    subtitle: '2D-архипелаг: Инфернальный биом, Часовая пустошь и лава',
    description:
      'Вулканический архипелаг по эталону: выжженная инфернальная земля с углями и обугленными деревьями, западная пустошь с часовыми механизмами, базальтовые хребты, лавовое море с яркой кромкой и титан Дистортус Рекс.',
    stageBg: 'dark',
    palette: {
      deepWater: ['#9E2210', '#961F0E'],
      midWater: ['#D64417', '#CE4015'],
      shallowWater: ['#F58626', '#EC7F21'],
      shoreRimColor: '#FFC24A',
      shore: ['#4F3834', '#46312E'],
      grass: ['#4E261F', '#46211B'], // Infernal scorched soil
      path: ['#3C2D2B', '#342624'],
      accentBiome: ['#6D543E', '#624B36'], // Clockwork / Paradox brown soil
      rock: ['#241F23', '#1C181B'],
      snow: ['#7D3622', '#692C1B'],
      flowerColors: ['#FF7B24', '#FFC438', '#C93818', '#524944'],
      waveColor: '#FFD65A',
      shadowHex: '#0A060856',
      isLava: true,
      seed: 202,
    },
    weatherIds: ['vfx-firestorm', 'weather-thundercloud'],
    placements: [
      { id: 'vf-ziggurat', modelId: 'obsidian-ziggurat', x: 168, y: 138, layer: 'ground', role: 'Зиккурат' },
      { id: 'vf-portal', modelId: 'hellfire-portal', x: 274, y: 136, layer: 'ground', role: 'Портал Пекла' },
      { id: 'vf-foundry', modelId: 'titan-foundry', x: 404, y: 132, layer: 'ground', role: 'Кузня Титанов' },
      { id: 'vf-forge', modelId: 'infernal-forge', x: 500, y: 164, layer: 'ground', role: 'Адская кузня' },
      // Nature & Substances
      { id: 'vf-deadwood-1', modelId: 'blighted-deadwood', x: 218, y: 118, layer: 'ground', role: 'Сухостой' },
      { id: 'vf-thorn', modelId: 'thorn-briar', x: 164, y: 192, layer: 'ground', role: 'Терновник' },
      { id: 'vf-vent-1', modelId: 'molten-basalt-vent', x: 356, y: 184, layer: 'ground', role: 'Лавовый гейзер' },
      { id: 'vf-obsidian', modelId: 'obsidian-monolith', x: 468, y: 208, layer: 'ground', role: 'Монолит' },
      { id: 'vf-bismuth', modelId: 'bismuth-hopper-crystal', x: 196, y: 222, layer: 'ground', role: 'Кристалл висмута' },
      { id: 'vf-ruby', modelId: 'ore-ruby-gem-deposit', x: 132, y: 166, layer: 'ground', role: 'Рубиновая руда' },
      { id: 'vf-adamantine', modelId: 'ore-adamantine-deposit', x: 452, y: 154, layer: 'ground', role: 'Адамантин' },
      // Creatures & Bosses
      { id: 'vf-drex', modelId: 'distortus-rex', x: 304, y: 228, layer: 'ground', patrolSpan: 32, patrolSpanY: 10, patrolSpeed: 0.08, role: 'Босс-мутант' },
      { id: 'vf-salamander', modelId: 'lava-salamander', x: 186, y: 242, layer: 'ground', patrolSpan: 22, patrolSpanY: 6, patrolSpeed: 0.18, phaseOffset: 1.1, role: 'Огненная саламандра' },
      { id: 'vf-salamander-2', modelId: 'lava-salamander', x: 398, y: 234, layer: 'ground', patrolSpan: 22, patrolSpanY: 6, patrolSpeed: 0.16, phaseOffset: 2.8, role: 'Саламандра' },
      { id: 'vf-magma', modelId: 'magma-colossus', x: 432, y: 194, layer: 'ground', patrolSpan: 18, patrolSpanY: 8, patrolSpeed: 0.1, phaseOffset: 2.3, role: 'Магма-голем' },
      { id: 'vf-exec', modelId: 'inferno-executioner', x: 492, y: 222, layer: 'ground', patrolSpan: 16, patrolSpanY: 8, patrolSpeed: 0.14, role: 'Палач Пекла' },
      { id: 'vf-imp', modelId: 'demon-imp', x: 234, y: 188, layer: 'ground', patrolSpan: 20, patrolSpanY: 10, patrolSpeed: 0.22, role: 'Бес' },
      // Overhead
      { id: 'vf-dragon', modelId: 'elder-dragon', x: 332, y: 92, layer: 'air', patrolSpan: 86, patrolSpanY: 22, patrolSpeed: 0.11, hoverBob: 3, role: 'Старший дракон' },
      { id: 'vf-thunder', modelId: 'weather-thundercloud', x: 184, y: 74, layer: 'sky', patrolSpan: 32, patrolSpeed: 0.05, role: 'Грозовая туча' },
      { id: 'vf-firestorm', modelId: 'vfx-firestorm', x: 332, y: 142, layer: 'sky', patrolSpan: 18, patrolSpeed: 0.06, role: 'Огненная буря' },
    ],
  },
  {
    id: 'frozen-fjord',
    name: 'Ледяной Фьорд',
    subtitle: '2D-архипелаг: тундра, кристальный биом и зачарованная сакура',
    description:
      'Северный архипелаг: снежная тундра и скалистые хребты, мятно-бирюзовый кристальный биом с гранеными деревьями, сиреневый биом волшебной сакуры со звёздным сиянием, ледовый бастион, мамонт, мозазавр и левиафан.',
    stageBg: 'parchment',
    palette: {
      deepWater: ['#225392', '#1F4D8A'],
      midWater: ['#3470B3', '#3069AA'],
      shallowWater: ['#5296CA', '#4C8FC2'],
      shoreRimColor: '#7BE3F2',
      shore: ['#B6C8D4', '#AABCC9'],
      grass: ['#DAE6EE', '#CFE0EB'], // Tundra snow
      path: ['#97AEC0', '#8CA3B5'],
      accentBiome: ['#459485', '#3D887A'], // Mint-Teal Crystal Biome soil
      rock: ['#515660', '#474B54'],
      snow: ['#F7FAFC', '#EBF3F8'],
      flowerColors: ['#5CF585', '#82F2F5', '#C2F0FF', '#FFFFFF'],
      waveColor: '#E1F5FA',
      shadowHex: '#13283F46',
      seed: 303,
    },
    weatherIds: ['vfx-arcane-aurora', 'weather-blizzard'],
    placements: [
      { id: 'ff-bastion', modelId: 'glacier-bastion', x: 196, y: 132, layer: 'ground', role: 'Ледовый бастион' },
      { id: 'ff-beacon', modelId: 'frost-beacon', x: 356, y: 134, layer: 'ground', role: 'Маяк мороза' },
      { id: 'ff-harbor', modelId: 'harbor-bastion', x: 492, y: 170, layer: 'ground', role: 'Морской бастион' },
      // Nature & Substances
      { id: 'ff-pine-1', modelId: 'nordic-pine', x: 146, y: 178, layer: 'ground', role: 'Северная ель' },
      { id: 'ff-pine-2', modelId: 'nordic-pine', x: 274, y: 120, layer: 'ground', role: 'Северная ель' },
      { id: 'ff-sakura', modelId: 'sakura-tree', x: 454, y: 126, layer: 'ground', role: 'Волшебная сакура' },
      { id: 'ff-holly', modelId: 'frost-holly', x: 416, y: 184, layer: 'ground', role: 'Морозный падуб' },
      { id: 'ff-spire', modelId: 'glacier-ice-spire', x: 268, y: 174, layer: 'ground', role: 'Ледяной шпиль' },
      { id: 'ff-geode', modelId: 'crystal-geode', x: 214, y: 212, layer: 'ground', role: 'Кристальная зона' },
      { id: 'ff-gold', modelId: 'gold-quartz-vein', x: 490, y: 214, layer: 'ground', role: 'Кварцевая жила' },
      { id: 'ff-silver', modelId: 'ore-silver-deposit', x: 148, y: 146, layer: 'ground', role: 'Серебряная руда' },
      { id: 'ff-mythril', modelId: 'ore-mythril-deposit', x: 304, y: 160, layer: 'ground', role: 'Мифриловая залежь' },
      // Creatures & Units
      { id: 'ff-mammoth', modelId: 'mega-mammoth', x: 256, y: 240, layer: 'ground', patrolSpan: 24, patrolSpanY: 10, patrolSpeed: 0.08, role: 'Шерстистый мамонт' },
      { id: 'ff-yeti', modelId: 'frost-yeti', x: 344, y: 208, layer: 'ground', patrolSpan: 22, patrolSpanY: 10, patrolSpeed: 0.13, phaseOffset: 1.4, role: 'Йети' },
      { id: 'ff-rhino', modelId: 'clockwork-rhino', x: 444, y: 220, layer: 'ground', patrolSpan: 22, patrolSpanY: 8, patrolSpeed: 0.11, phaseOffset: 2.5, role: 'Паровой носорог' },
      { id: 'ff-warden', modelId: 'frost-warden', x: 162, y: 204, layer: 'ground', patrolSpan: 16, patrolSpanY: 8, patrolSpeed: 0.11, role: 'Страж льда' },
      // Weather
      { id: 'ff-aurora', modelId: 'vfx-arcane-aurora', x: 310, y: 74, layer: 'sky', patrolSpan: 44, patrolSpeed: 0.04, role: 'Полярное сияние' },
      { id: 'ff-blizzard', modelId: 'weather-blizzard', x: 380, y: 156, layer: 'sky', patrolSpan: 32, patrolSpeed: 0.06, role: 'Метель' },
      // Aquatic inside lower fjord
      { id: 'ff-mosasaurus', modelId: 'mosasaurus', x: 178, y: 318, layer: 'water', patrolSpan: 56, patrolSpanY: 6, patrolSpeed: 0.1, role: 'Мозазавр' },
      { id: 'ff-leviathan', modelId: 'leviathan', x: 454, y: 320, layer: 'water', patrolSpan: 56, patrolSpanY: 6, patrolSpeed: 0.09, phaseOffset: 2.2, role: 'Левиафан' },
    ],
  },
  {
    id: 'blighted-swamp',
    name: 'Туманные Топи',
    subtitle: '2D-архипелаг: Проклятые земли с костями и Грибная роща',
    description:
      'Топ-даун болотно-проклятый архипелаг: фиолетово-пепельные проклятые земли с костями и мрачными деревьями с алыми глазами, переходящие в зелёный грибной биом с розовыми грибницами, гидрой, крокодилом Густавом, жнецом бездны и базилозавром.',
    stageBg: 'meadow',
    palette: {
      deepWater: ['#193D3B', '#163735'],
      midWater: ['#255752', '#22514C'],
      shallowWater: ['#3B7A6F', '#357066'],
      shoreRimColor: '#67B8AC',
      shore: ['#6A6B52', '#5F6049'],
      grass: ['#4F4558', '#473D50'], // Corrupted violet-ash soil
      path: ['#3A313D', '#322A35'],
      accentBiome: ['#58AD3F', '#509E39'], // Bright Mushroom Biome grass!
      rock: ['#2D2A33', '#25222A'],
      snow: ['#494C57', '#3E414B'],
      flowerColors: ['#E6D8C5', '#D66CE6', '#F25E5E', '#67B8E8'],
      waveColor: '#90DBCA',
      shadowHex: '#0A131052',
      seed: 404,
    },
    weatherIds: ['weather-fog-bank', 'weather-rain'],
    placements: [
      { id: 'bs-necro', modelId: 'necro-citadel-t3', x: 178, y: 138, layer: 'ground', role: 'Некро-цитадель' },
      { id: 'bs-ossuary', modelId: 'bone-ossuary', x: 318, y: 128, layer: 'ground', role: 'Усыпальница' },
      { id: 'bs-windmill', modelId: 'bone-windmill', x: 462, y: 142, layer: 'ground', role: 'Костяная мельница' },
      { id: 'bs-obelisk', modelId: 'summoning-obelisk', x: 500, y: 186, layer: 'ground', role: 'Обелиск призыва' },
      // Nature & Substances
      { id: 'bs-deadwood', modelId: 'blighted-deadwood', x: 148, y: 174, layer: 'ground', role: 'Мёртвое дерево' },
      { id: 'bs-fungal-1', modelId: 'fungal-cluster', x: 234, y: 194, layer: 'ground', role: 'Светящиеся грибы' },
      { id: 'bs-fungal-2', modelId: 'fungal-cluster', x: 402, y: 196, layer: 'ground', role: 'Грибница' },
      { id: 'bs-amber', modelId: 'amber-fossil-pillar', x: 478, y: 218, layer: 'ground', role: 'Янтарный столб' },
      { id: 'bs-acid', modelId: 'acid-geyser', x: 332, y: 174, layer: 'ground', role: 'Кислотный гейзер' },
      // Creatures & Units
      { id: 'bs-hydra', modelId: 'spore-hydra', x: 248, y: 232, layer: 'ground', patrolSpan: 20, patrolSpanY: 7, patrolSpeed: 0.1, role: 'Грибная гидра' },
      { id: 'bs-gustave', modelId: 'gustave-crocodile', x: 318, y: 236, layer: 'ground', patrolSpan: 18, patrolSpanY: 5, patrolSpeed: 0.09, phaseOffset: 0.8, role: 'Крокодил Густав' },
      { id: 'bs-reaper', modelId: 'abyssal-reaper', x: 390, y: 222, layer: 'ground', patrolSpan: 22, patrolSpanY: 9, patrolSpeed: 0.15, hoverBob: 2, role: 'Жнец бездны' },
      { id: 'bs-lich', modelId: 'lich-archmage', x: 192, y: 214, layer: 'ground', patrolSpan: 16, patrolSpanY: 8, patrolSpeed: 0.11, role: 'Архилич' },
      { id: 'bs-slime', modelId: 'slime-cube', x: 446, y: 228, layer: 'ground', patrolSpan: 20, patrolSpanY: 8, patrolSpeed: 0.15, phaseOffset: 1.6, role: 'Слизь' },
      // Overhead
      { id: 'bs-wyvern', modelId: 'bone-wyvern', x: 340, y: 102, layer: 'air', patrolSpan: 82, patrolSpanY: 22, patrolSpeed: 0.12, hoverBob: 3, role: 'Костяной виверн' },
      { id: 'bs-fog', modelId: 'weather-fog-bank', x: 256, y: 156, layer: 'sky', patrolSpan: 34, patrolSpeed: 0.05, role: 'Туман' },
      { id: 'bs-rain', modelId: 'weather-rain', x: 190, y: 108, layer: 'sky', patrolSpan: 26, patrolSpeed: 0.06, role: 'Дождь' },
      // Water
      { id: 'bs-basilo', modelId: 'basilosaurus', x: 320, y: 318, layer: 'water', patrolSpan: 92, patrolSpanY: 5, patrolSpeed: 0.1, role: 'Базилозавр' },
    ],
  },
  {
    id: 'coastal-oasis',
    name: 'Солнечный Оазис',
    subtitle: '2D-остров: Цветочная поляна, Саванна, Оазис и океан',
    description:
      'Точно по эталону: цветущий зелёный остров с крупными яркими цветами, золотая саванна с акациями на северо-востоке, песчаный оазис с пальмами, коралловый риф в лагуне, галеон, кракен и мегалодон в океане.',
    stageBg: 'parchment',
    palette: {
      deepWater: ['#265CA8', '#23569E'],
      midWater: ['#3B74BA', '#376EB2'],
      shallowWater: ['#5689C6', '#5183BE'],
      shoreRimColor: '#76C7F0',
      shore: ['#DEC98B', '#D3BD7F'],
      grass: ['#53A339', '#4C9834'], // Lush meadow green
      path: ['#CBB679', '#BFAA6D'],
      accentBiome: ['#BA8E30', '#AD832A'], // Golden Savanna grass
      rock: ['#857A6B', '#786D5F'],
      snow: ['#E6D8C5', '#D9CBB8'],
      flowerColors: ['#E63E8A', '#F2D335', '#E84D3D', '#FFFFFF'],
      waveColor: '#B8ECFA',
      shadowHex: '#12290548',
      seed: 505,
    },
    weatherIds: ['weather-sandstorm', 'vfx-water-geyser'],
    placements: [
      { id: 'co-cathedral', modelId: 'grand-cathedral', x: 244, y: 132, layer: 'ground', role: 'Собор' },
      { id: 'co-lab', modelId: 'alchemist-lab', x: 362, y: 134, layer: 'ground', role: 'Лаборатория' },
      { id: 'co-dock', modelId: 'sky-galleon-dock', x: 492, y: 164, layer: 'ground', role: 'Небесная верфь' },
      // Nature & Substances
      { id: 'co-palm-1', modelId: 'oasis-palm', x: 182, y: 188, layer: 'ground', role: 'Пальма' },
      { id: 'co-palm-2', modelId: 'oasis-palm', x: 424, y: 218, layer: 'ground', role: 'Пальма' },
      { id: 'co-bamboo', modelId: 'bamboo-grove', x: 294, y: 184, layer: 'ground', role: 'Бамбук' },
      { id: 'co-maple-1', modelId: 'autumn-maple', x: 462, y: 112, layer: 'ground', role: 'Акация саванны' },
      { id: 'co-berry', modelId: 'berry-bush', x: 336, y: 212, layer: 'ground', role: 'Куст ягод' },
      { id: 'co-boiler', modelId: 'brass-steam-boiler', x: 432, y: 144, layer: 'ground', role: 'Паровой котёл' },
      // Land Creatures & Units
      { id: 'co-trex', modelId: 'tyrannosaurus-rex', x: 316, y: 228, layer: 'ground', patrolSpan: 28, patrolSpanY: 8, patrolSpeed: 0.1, role: 'Тираннозавр Рекс' },
      { id: 'co-scarab', modelId: 'scarab-colossus', x: 254, y: 222, layer: 'ground', patrolSpan: 30, patrolSpanY: 10, patrolSpeed: 0.16, role: 'Солнечный скарабей' },
      { id: 'co-sunpriest', modelId: 'dune-sunpriest', x: 212, y: 194, layer: 'ground', patrolSpan: 14, patrolSpanY: 8, patrolSpeed: 0.12, role: 'Жрец солнца' },
      { id: 'co-samurai', modelId: 'lotus-samurai', x: 372, y: 212, layer: 'ground', patrolSpan: 18, patrolSpanY: 8, patrolSpeed: 0.14, phaseOffset: 1.5, role: 'Самурай лотоса' },
      { id: 'co-rhino', modelId: 'clockwork-rhino', x: 472, y: 214, layer: 'ground', patrolSpan: 18, patrolSpanY: 6, patrolSpeed: 0.11, role: 'Паровой носорог' },
      // Sea & Reef (top-left bay + lower ocean)
      { id: 'co-coral', modelId: 'coral-reef-colony', x: 76, y: 98, layer: 'water', role: 'Коралловый риф' },
      { id: 'co-geyser', modelId: 'vfx-water-geyser', x: 266, y: 316, layer: 'water', role: 'Водяной гейзер' },
      { id: 'co-galleon', modelId: 'war-galleon', x: 138, y: 314, layer: 'water', patrolSpan: 48, patrolSpanY: 6, patrolSpeed: 0.08, role: 'Боевой галеон' },
      { id: 'co-kraken', modelId: 'kraken', x: 410, y: 318, layer: 'water', patrolSpan: 40, patrolSpanY: 6, patrolSpeed: 0.1, phaseOffset: 1.8, role: 'Кракен' },
      { id: 'co-megalodon', modelId: 'megalodon', x: 544, y: 320, layer: 'water', patrolSpan: 42, patrolSpanY: 6, patrolSpeed: 0.14, phaseOffset: 0.5, role: 'Мегалодон' },
      // Weather
      { id: 'co-sand', modelId: 'weather-sandstorm', x: 244, y: 242, layer: 'sky', patrolSpan: 28, patrolSpeed: 0.05, role: 'Песчаный вихрь' },
    ],
  },
];

function hash2d(seed: number, ix: number, iy: number): number {
  let h = (seed * 1619 + ix * 374761393 + iy * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise2d(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const a = hash2d(seed, ix, iy);
  const b = hash2d(seed, ix + 1, iy);
  const c = hash2d(seed, ix, iy + 1);
  const d = hash2d(seed, ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function fbm2d(seed: number, x: number, y: number): number {
  const n1 = valueNoise2d(seed, x, y);
  const n2 = valueNoise2d(seed + 31, x * 2.1, y * 2.1) * 0.5;
  const n3 = valueNoise2d(seed + 79, x * 4.3, y * 4.3) * 0.25;
  return (n1 + n2 + n3) / 1.75 - 0.5;
}

function islandCore(u: number, v: number, cx = 0.51, cy = 0.44, rx = 0.46, ry = 0.38): number {
  const dx = Math.abs((u - cx) / rx);
  const dy = Math.abs((v - cy) / ry);
  return 1 - Math.pow(Math.pow(dx, 2.5) + Math.pow(dy, 2.5), 1 / 2.5);
}

/**
 * Pure 2D fractal tile classifier on the 160x90 (4x4 px) sandbox grid.
 */
export function classifyBiomeTile(biomeId: BiomeId, tx: number, ty: number): TopDownTileType {
  const u = tx / GRID_COLS;
  const v = ty / GRID_ROWS;

  if (biomeId === 'forest-citadel') {
    const n = fbm2d(101, tx * 0.085, ty * 0.085);
    const fine = fbm2d(149, tx * 0.24, ty * 0.24) * 0.35;
    const core = islandCore(u, v, 0.51, 0.43, 0.46, 0.38);
    const islet = 1 - Math.hypot((u - 0.83) / 0.1, (v - 0.83) / 0.09);
    const elev = Math.max(core, islet * 0.65) * 10 + (n + fine) * 4.8;

    if (elev <= -2.1) return 'deepWater';
    if (elev <= -0.9) return 'midWater';
    if (elev <= 0.1) return 'shallowWater';
    if (elev <= 1.15) return 'shore';

    // Prominent NW granite + snow mountain ridge visibly inside continent
    const mtn = (1 - Math.hypot((u - 0.22) / 0.14, (v - 0.28) / 0.19)) * 10 + (n + fine) * 4.2;
    if (mtn > 5.0) return 'snow';
    if (mtn > 2.9) return 'rock';

    const pathY = 38 + Math.sin(tx * 0.055) * 3.8 + n * 2.5;
    const branchX = 104 + Math.cos(ty * 0.11) * 3;
    if (
      (tx > 42 && tx < 130 && Math.abs(ty - pathY) < 1.3) ||
      (ty > pathY && ty < 60 && Math.abs(tx - branchX) < 1.4)
    ) {
      return 'path';
    }

    // Lush eastern Autumn Maple zone
    const autumnZone = 1 - Math.hypot((u - 0.77) / 0.22, (v - 0.45) / 0.28) + (n + fine) * 0.48;
    if (autumnZone > 0.34) return 'accentBiome';
    return 'grass';
  }

  if (biomeId === 'volcanic-forge') {
    const n = fbm2d(202, tx * 0.09, ty * 0.09);
    const fine = fbm2d(257, tx * 0.24, ty * 0.24) * 0.35;
    const core = islandCore(u, v, 0.51, 0.43, 0.46, 0.38);
    const craterHole = (1 - Math.hypot((u - 0.88) / 0.13, (v - 0.14) / 0.13)) * 9;
    const elev = core * 10 - Math.max(0, craterHole) + (n + fine) * 4.8;

    if (elev <= -2.0) return 'deepWater';
    if (elev <= -0.8) return 'midWater';
    if (elev <= 0.1) return 'shallowWater';
    if (elev <= 1.1) return 'shore';

    const ridge = (1 - Math.hypot((u - 0.19) / 0.11, (v - 0.32) / 0.22)) * 10 + (n + fine) * 4.2;
    if (ridge > 5.8) return 'snow';
    if (ridge > 3.6) return 'rock';

    const pathY = 39 + Math.cos(tx * 0.06) * 3.5 + n * 2.5;
    if (tx > 38 && tx < 132 && Math.abs(ty - pathY) < 1.3) return 'path';

    // Clockwork Wasteland plateau on center-west
    const clockworkZone = 1 - Math.hypot((u - 0.36) / 0.17, (v - 0.52) / 0.2) + (n + fine) * 0.45;
    if (clockworkZone > 0.35) return 'accentBiome';
    return 'grass';
  }

  if (biomeId === 'frozen-fjord') {
    const n = fbm2d(303, tx * 0.085, ty * 0.085);
    const fine = fbm2d(353, tx * 0.24, ty * 0.24) * 0.35;
    const core = islandCore(u, v, 0.51, 0.42, 0.46, 0.37);
    const southInlet = (1 - Math.hypot((u - 0.5) / 0.28, (v - 0.86) / 0.16)) * 6;
    const elev = core * 10 - Math.max(0, southInlet) + (n + fine) * 4.8;

    if (elev <= -2.2) return 'deepWater';
    if (elev <= -0.9) return 'midWater';
    if (elev <= 0.1) return 'shallowWater';
    if (elev <= 1.1) return 'shore';

    const mtn = (1 - Math.hypot((u - 0.21) / 0.14, (v - 0.26) / 0.19)) * 10 + (n + fine) * 4.2;
    if (mtn > 4.9) return 'snow';
    if (mtn > 2.8) return 'rock';

    // Mint-teal Crystal biome zone in center
    const crystal = 1 - Math.hypot((u - 0.36) / 0.17, (v - 0.53) / 0.18) + (n + fine) * 0.45;
    if (crystal > 0.33) return 'accentBiome';

    const pathY = 38 + Math.sin(tx * 0.055) * 3.5 + n * 2.5;
    if (tx > 42 && tx < 130 && Math.abs(ty - pathY) < 1.3) return 'path';
    return 'grass';
  }

  if (biomeId === 'blighted-swamp') {
    const n = fbm2d(404, tx * 0.09, ty * 0.09);
    const fine = fbm2d(461, tx * 0.24, ty * 0.24) * 0.35;
    const core = islandCore(u, v, 0.51, 0.43, 0.46, 0.37);
    const bogChannel = (1 - Math.hypot((u - 0.52) / 0.34, (v - 0.86) / 0.15)) * 7;
    const elev = core * 10 - Math.max(0, bogChannel) + (n + fine) * 4.8;

    if (elev <= -2.1) return 'deepWater';
    if (elev <= -0.9) return 'midWater';
    if (elev <= 0.1) return 'shallowWater';
    if (elev <= 1.1) return 'shore';

    const ridge = (1 - Math.hypot((u - 0.84) / 0.1, (v - 0.22) / 0.14)) * 10 + (n + fine) * 4.0;
    if (ridge > 4.2) return 'rock';

    // Spring-green Mushroom biome on eastern half
    const mushroomZone = 1 - Math.hypot((u - 0.65) / 0.21, (v - 0.49) / 0.22) + (n + fine) * 0.48;
    if (mushroomZone > 0.34) return 'accentBiome';

    const pathY = 39 + Math.sin(tx * 0.06) * 3.5 + n * 2.5;
    if (tx > 38 && tx < 134 && Math.abs(ty - pathY) < 1.3) return 'path';
    return 'grass';
  }

  // coastal-oasis
  const n = fbm2d(505, tx * 0.085, ty * 0.085);
  const fine = fbm2d(563, tx * 0.24, ty * 0.24) * 0.35;
  const core = islandCore(u, v, 0.54, 0.43, 0.44, 0.37);
  const topLeftLagoon = (1 - Math.hypot((u - 0.12) / 0.2, (v - 0.24) / 0.24)) * 8.5;
  const elev = core * 10 - Math.max(0, topLeftLagoon) + (n + fine) * 4.8;

  if (elev <= -2.1) return 'deepWater';
  if (elev <= -0.9) return 'midWater';
  if (elev <= 0.1) return 'shallowWater';
  if (elev <= 1.65) return 'shore';

  const savannaCorner = 1 - Math.hypot((u - 0.78) / 0.22, (v - 0.28) / 0.22) + (n + fine) * 0.45;
  if (savannaCorner > 0.34) return 'accentBiome';

  const pathY = 39 + Math.sin(tx * 0.06) * 3 + n * 2;
  if (tx > 46 && tx < 128 && Math.abs(ty - pathY) < 1.3) return 'path';
  return 'grass';
}

export function isBiomeWaterPixel(biomeId: BiomeId, px: number, py: number): boolean {
  const tx = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(px / TILE_SIZE)));
  const ty = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(py / TILE_SIZE)));
  const tile = classifyBiomeTile(biomeId, tx, ty);
  return tile === 'deepWater' || tile === 'midWater' || tile === 'shallowWater';
}

function blendShadowPixel(buf: PixelBuffer, x: number, y: number, shadowHex: string): void {
  const dst = buf.getPixel(x, y);
  if (!dst) return;
  const [dr, dg, db] = hexToRgba(dst);
  const [sr, sg, sb, sa] = hexToRgba(shadowHex);
  const a = sa / 255;
  const inv = 1 - a;
  buf.setPixel(x, y, rgbToHex(sr * a + dr * inv, sg * a + dg * inv, sb * a + db * inv));
}

function drawMicroShadow(buf: PixelBuffer, cx: number, by: number, rx: number, shadowHex: string): void {
  // Crisp diagonal down-right ground shadow composited directly onto terrain pixels
  for (let dy = 0; dy <= 2; dy++) {
    const startX = dy + 1;
    const span = dy === 2 ? Math.max(2, rx - 1) : rx + 2;
    for (let dx = startX; dx <= startX + span; dx++) {
      blendShadowPixel(buf, cx + dx, by + dy, shadowHex);
    }
  }
}

/**
 * Draws lush, borderless trees, flowers, crystals, mushrooms,
 * acacias, palms, bone piles & volcano craters directly onto terrain.
 */
function drawAmbientSandboxFlora(
  buf: PixelBuffer,
  biome: BiomeDefinition,
  tileMap: TopDownTileType[],
  clearedFloraMask?: Uint8Array
): void {
  const { palette } = biome;

  const isTooCloseToHero = (px: number, py: number) => {
    for (const pl of biome.placements) {
      if (pl.layer !== 'ground') continue;
      const dist = Math.hypot(px - pl.x, (py - (pl.y - 12)) * 1.15);
      if (dist < 28) return true;
    }
    return false;
  };

  // Draw a mini glowing volcano cone on the NW rock ridge of forest-citadel or volcanic-forge
  if (biome.id === 'forest-citadel' || biome.id === 'volcanic-forge') {
    let vx = 0;
    let vy = 0;
    for (let ty = 12; ty < 45 && vx === 0; ty++) {
      for (let tx = 18; tx < 52; tx++) {
        if (tileMap[ty * GRID_COLS + tx] === 'rock') {
          vx = tx * TILE_SIZE + 2;
          vy = ty * TILE_SIZE + 2;
          break;
        }
      }
    }
    if (vx > 0 && !isTooCloseToHero(vx, vy)) {
      drawMicroShadow(buf, vx, vy + 2, 7, palette.shadowHex);
      buf.fillRect(vx - 6, vy - 2, 12, 5, '#3D3B40');
      buf.fillRect(vx - 5, vy - 5, 10, 4, '#4F4D54');
      buf.fillRect(vx - 4, vy - 7, 8, 3, '#615F66');
      buf.fillRect(vx - 3, vy - 7, 6, 2, '#E84D1A');
      buf.fillRect(vx - 2, vy - 8, 4, 2, '#FFC438');
      buf.setPixel(vx - 5, vy - 11, '#FFC438');
      buf.setPixel(vx + 4, vy - 12, '#FF7B24');
      buf.setPixel(vx + 1, vy - 14, '#FFE678');
    }
  }

  for (let ty = 3; ty < GRID_ROWS - 3; ty++) {
    for (let tx = 3; tx < GRID_COLS - 3; tx++) {
      const tile = tileMap[ty * GRID_COLS + tx];
      const h = Math.floor(hash2d(palette.seed + 777, tx, ty) * 10000);
      const px = tx * TILE_SIZE + 2;
      const py = ty * TILE_SIZE + 3;

      if (clearedFloraMask && clearedFloraMask[ty * GRID_COLS + tx] > 0) {
        continue;
      }

      if (tile === 'shore' && biome.id === 'coastal-oasis' && h % 97 === 0 && !isTooCloseToHero(px, py)) {
        // Sandy desert palm tree
        drawMicroShadow(buf, px, py, 5, palette.shadowHex);
        buf.fillRect(px - 1, py - 9, 2, 9, '#9C6B3B');
        buf.setPixel(px, py - 5, '#7A4F26');
        buf.fillRect(px - 5, py - 11, 4, 2, '#69AD3B');
        buf.fillRect(px + 1, py - 11, 4, 2, '#4A8226');
        buf.fillRect(px - 4, py - 13, 8, 2, '#82C74A');
        buf.fillRect(px - 2, py - 14, 4, 2, '#A2DE64');
        continue;
      }

      if (tile === 'grass' || tile === 'accentBiome') {
        if (isTooCloseToHero(px, py)) continue;

        const upTile = tileMap[(ty - 1) * GRID_COLS + tx];
        const dnTile = tileMap[(ty + 1) * GRID_COLS + tx];
        if (upTile !== tile || dnTile === 'shallowWater' || dnTile === 'path') {
          continue;
        }

        // Dense lush borderless trees (12-16px multi-lobed pixel art + diagonal shadows)
        if (h % 39 === 0 && (tx + ty) % 2 === 0) {
          drawMicroShadow(buf, px, py, 6, palette.shadowHex);
          if (biome.id === 'volcanic-forge') {
            if (tile === 'accentBiome') {
              // Clockwork twisted brown tree with golden clock face
              buf.fillRect(px - 1, py - 10, 2, 10, '#2B221D');
              buf.fillRect(px - 4, py - 12, 3, 2, '#2B221D');
              buf.fillRect(px + 1, py - 13, 3, 2, '#3D3129');
              buf.fillEllipse(px, py - 6, 3, 3, () => '#E8B838');
              buf.fillEllipse(px, py - 6, 1.8, 1.8, () => '#F7F0D4');
              buf.setPixel(px, py - 6, '#3D3129');
            } else {
              // Infernal charred dark tree with fiery orange-red embers
              buf.fillRect(px - 1, py - 10, 2, 10, '#2E1F1D');
              buf.fillRect(px - 4, py - 11, 3, 2, '#3B231E');
              buf.fillRect(px + 1, py - 12, 3, 2, '#261816');
              buf.setPixel(px - 3, py - 12, '#FF5C1F');
              buf.setPixel(px + 2, py - 13, '#FF9E2C');
              buf.setPixel(px, py - 9, '#FF6A1F');
            }
          } else if (biome.id === 'frozen-fjord') {
            if (tile === 'accentBiome') {
              // Neon Mint-Teal Crystal Tree
              buf.fillRect(px - 1, py - 6, 2, 6, '#2F6E65');
              buf.fillEllipse(px - 2, py - 9, 3, 2.2, () => '#4AE87D');
              buf.fillEllipse(px + 2, py - 8, 3, 2.2, () => '#27C466');
              buf.fillEllipse(px, py - 12, 3.5, 2.5, (nx, ny) =>
                ny < 0 || nx < 0 ? '#9BFFAD' : '#3DE078'
              );
              buf.setPixel(px - 1, py - 13, '#E0FFFF');
            } else {
              // Snowy frost pine (multi-tiered conifer)
              buf.fillRect(px - 1, py - 4, 2, 4, '#6B4226');
              for (let r = 0; r < 10; r++) {
                const w = Math.max(1, Math.floor((r + 1) * 0.58));
                const c = r < 3 ? '#EEF6FA' : r % 2 === 0 ? '#2D6B4E' : '#1F523B';
                buf.fillRect(px - w, py - 13 + r, w * 2, 1, c);
              }
            }
          } else if (biome.id === 'blighted-swamp') {
            if (tile === 'accentBiome') {
              // Giant Mushroom Tree
              buf.fillRect(px - 1, py - 7, 3, 7, '#A690A3');
              buf.fillEllipse(px, py - 9, 5.2, 3.2, (nx, ny) => {
                if (nx < -0.2 && ny < -0.2) return '#F091D6';
                if (nx > 0.35 || ny > 0.35) return '#94438F';
                return '#CE64B8';
              });
              buf.setPixel(px - 2, py - 10, '#FFE0F7');
              buf.setPixel(px + 2, py - 9, '#FFE0F7');
            } else {
              // Corrupted gnarled dark dead tree with glowing red eyes
              buf.fillRect(px - 2, py - 10, 4, 10, '#362626');
              buf.fillRect(px - 5, py - 13, 3, 3, '#2B1D1E');
              buf.fillRect(px + 2, py - 13, 3, 3, '#2B1D1E');
              buf.fillRect(px - 1, py - 14, 2, 4, '#422F2F');
              buf.setPixel(px - 1, py - 7, '#FF3B3B');
              buf.setPixel(px + 1, py - 7, '#FF3B3B');
            }
          } else if (biome.id === 'coastal-oasis' && tile === 'accentBiome') {
            // Savanna Flat-Topped Acacia Tree
            buf.fillRect(px - 1, py - 8, 2, 8, '#6B4828');
            buf.fillRect(px - 3, py - 10, 6, 2, '#6B4828');
            const isAmber = h % 2 === 0;
            buf.fillEllipse(px, py - 12, 6, 2.6, (nx, ny) => {
              if (ny < -0.2) return isAmber ? '#F29A2E' : '#94BA3D';
              if (nx > 0.35 || ny > 0.35) return isAmber ? '#AD4C14' : '#53731F';
              return isAmber ? '#D96D1F' : '#739C2D';
            });
          } else if (tile === 'accentBiome') {
            // Crimson/Amber/Gold Autumn Maple Tree
            buf.fillRect(px - 1, py - 7, 2, 7, '#754626');
            const variant = h % 3;
            buf.fillEllipse(px - 2, py - 9, 3.6, 3.2, () =>
              variant === 0 ? '#A8261A' : variant === 1 ? '#D67B1E' : '#C9941A'
            );
            buf.fillEllipse(px + 2, py - 9, 3.6, 3.2, () =>
              variant === 0 ? '#8C1E14' : variant === 1 ? '#B55B14' : '#A67212'
            );
            buf.fillEllipse(px, py - 12, 4.4, 3.8, (nx, ny) => {
              if (nx < -0.15 && ny < -0.15)
                return variant === 0 ? '#EB4D38' : variant === 1 ? '#FAAC32' : '#F7DE4A';
              if (nx > 0.35 || ny > 0.35)
                return variant === 0 ? '#8F1E14' : variant === 1 ? '#B85A14' : '#A67212';
              return variant === 0 ? '#C93022' : variant === 1 ? '#E68A22' : '#E3BD2D';
            });
          } else {
            // Multi-Lobed Birch & Oak Tree
            const isBirch = biome.id === 'forest-citadel' && h % 2 === 0;
            buf.fillRect(px - 1, py - 7, 2, 7, isBirch ? '#D6D4CC' : '#784A26');
            if (isBirch) buf.setPixel(px, py - 4, '#595550');
            buf.fillEllipse(px - 2, py - 9, 3.8, 3.2, () => '#387D24');
            buf.fillEllipse(px + 2, py - 9, 3.8, 3.2, () => '#2C631C');
            buf.fillEllipse(px, py - 12, 4.6, 3.8, (nx, ny) => {
              if (nx < -0.2 && ny < -0.2) return '#8AD651';
              if (nx > 0.35 || ny > 0.35) return '#316E21';
              return '#56A835';
            });
          }
          continue;
        }

        // Flower Meadow vibrant big flowers
        if (biome.id === 'coastal-oasis' && tile === 'grass' && h % 29 === 0) {
          drawMicroShadow(buf, px, py, 3, palette.shadowHex);
          buf.fillRect(px, py - 5, 1, 5, '#357322');
          buf.setPixel(px - 1, py - 2, '#4A9632');
          const petal = h % 3 === 0 ? '#E83F8C' : h % 3 === 1 ? '#F5D636' : '#EB4B3B';
          const darkPetal = h % 3 === 0 ? '#A82661' : h % 3 === 1 ? '#C79B1E' : '#B0281B';
          buf.fillEllipse(px, py - 7, 3.2, 2.8, (nx, ny) => (ny > 0.25 || nx > 0.3 ? darkPetal : petal));
          buf.fillRect(px - 1, py - 8, 2, 2, h % 3 === 1 ? '#C97B18' : '#FFF082');
          continue;
        }

        // Bushes / bones / ember stones
        if (h % 37 === 0) {
          drawMicroShadow(buf, px, py, 3, palette.shadowHex);
          if (biome.id === 'volcanic-forge') {
            buf.fillEllipse(px, py - 2, 2.8, 2, () => '#3B282A');
            buf.setPixel(px, py - 3, '#FF8C29');
          } else if (biome.id === 'blighted-swamp' && tile === 'grass') {
            buf.fillRect(px - 2, py - 2, 4, 2, '#D9CBB8');
            buf.setPixel(px - 1, py - 3, '#EDE2D3');
          } else if (biome.id === 'frozen-fjord') {
            buf.fillEllipse(px, py - 2, 3, 2, (_, ny) => (ny < -0.1 ? '#F2F8FC' : '#356B56'));
          } else {
            buf.fillEllipse(px, py - 2, 3.4, 2.4, (nx, ny) => {
              if (nx < -0.2 && ny < -0.2) return '#6EC242';
              if (nx > 0.3 || ny > 0.3) return '#2B5E1E';
              return '#458F2C';
            });
            buf.setPixel(px - 1, py - 2, biome.id === 'coastal-oasis' ? '#F5D64B' : '#E34B4B');
            buf.setPixel(px + 1, py - 3, biome.id === 'coastal-oasis' ? '#F5D64B' : '#E34B4B');
          }
        }
      }
    }
  }
}

/**
 * Builds the mutable 160x90 tile grid for a biome.
 */
export function buildBiomeTileGrid(biomeId: BiomeId): TopDownTileType[] {
  const tileMap = new Array<TopDownTileType>(GRID_COLS * GRID_ROWS);
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      tileMap[ty * GRID_COLS + tx] = classifyBiomeTile(biomeId, tx, ty);
    }
  }
  return tileMap;
}

/**
 * Renders a 640x360 top-down backdrop from a mutable 160x90 tile grid,
 * optional tectonic crack / rubble masks (from earthquakes & tornados),
 * and cleared-flora mask (where disasters uprooted ambient trees).
 */
export function renderBiomeBackdropFromGrid(
  biome: BiomeDefinition,
  tileMap: TopDownTileType[],
  crackMap?: Uint8Array,
  rubbleMap?: Uint8Array,
  clearedFloraMask?: Uint8Array
): PixelBuffer {
  const buf = new PixelBuffer(BIOME_WIDTH, BIOME_HEIGHT);
  const { palette } = biome;

  const isLandTile = (t: TopDownTileType | undefined) =>
    t !== undefined && t !== 'deepWater' && t !== 'midWater' && t !== 'shallowWater';

  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const idx = ty * GRID_COLS + tx;
      const tileType = tileMap[idx];
      const baseColor = palette[tileType][0];
      const altColor = palette[tileType][1];

      const x0 = tx * TILE_SIZE;
      const y0 = ty * TILE_SIZE;
      buf.fillRect(x0, y0, TILE_SIZE, TILE_SIZE, baseColor);

      const h = Math.floor(hash2d(palette.seed, tx, ty) * 10000);

      if (tileType === 'shallowWater') {
        const nLand = ty > 0 && isLandTile(tileMap[(ty - 1) * GRID_COLS + tx]);
        const sLand = ty < GRID_ROWS - 1 && isLandTile(tileMap[(ty + 1) * GRID_COLS + tx]);
        const wLand = tx > 0 && isLandTile(tileMap[ty * GRID_COLS + (tx - 1)]);
        const eLand = tx < GRID_COLS - 1 && isLandTile(tileMap[ty * GRID_COLS + (tx + 1)]);
        if (nLand) buf.fillRect(x0, y0, TILE_SIZE, 2, palette.shoreRimColor);
        if (sLand) buf.fillRect(x0, y0 + TILE_SIZE - 2, TILE_SIZE, 2, palette.shoreRimColor);
        if (wLand) buf.fillRect(x0, y0, 2, TILE_SIZE, palette.shoreRimColor);
        if (eLand) buf.fillRect(x0 + TILE_SIZE - 2, y0, 2, TILE_SIZE, palette.shoreRimColor);
      } else if (tileType === 'grass' || tileType === 'accentBiome') {
        if (h % 2 === 0) buf.fillRect(x0 + (h % 3), y0 + ((h >> 2) % 3), 2, 2, altColor);
        if (h % 5 === 0) buf.setPixel(x0 + ((h >> 4) % 4), y0 + ((h >> 6) % 4), altColor);
        if (h % 23 === 0) {
          const fc = palette.flowerColors[h % palette.flowerColors.length];
          buf.setPixel(x0 + 1, y0 + 1, fc);
          buf.setPixel(x0 + 2, y0 + 2, fc);
        }
      } else if (tileType === 'shore' || tileType === 'path') {
        if (h % 3 === 0) buf.fillRect(x0 + (h % 3), y0 + ((h >> 2) % 3), 2, 2, altColor);
      } else if (tileType === 'rock') {
        if (h % 3 === 0) buf.fillRect(x0 + 1, y0 + 1, 2, 2, altColor);
        if (ty > 0 && tileMap[(ty - 1) * GRID_COLS + tx] !== 'rock' && tileMap[(ty - 1) * GRID_COLS + tx] !== 'snow') {
          buf.fillRect(x0, y0, TILE_SIZE, 1, '#9FA3AB');
        }
        if (ty < GRID_ROWS - 1 && tileMap[(ty + 1) * GRID_COLS + tx] !== 'rock' && tileMap[(ty + 1) * GRID_COLS + tx] !== 'snow') {
          buf.fillRect(x0, y0 + TILE_SIZE - 1, TILE_SIZE, 1, '#4C4E56');
        }
        if (h % 11 === 0) buf.setPixel(x0 + (h % 3), y0 + 2, '#4A4D54');
      } else if (tileType === 'snow') {
        if (h % 3 === 0) buf.fillRect(x0 + 1, y0 + 1, 2, 2, altColor);
        if (h % 17 === 0) buf.setPixel(x0 + 2, y0 + 1, palette.rock[0]);
      }

      // Subtle organic earthquake fracture seam & collapsed rubble
      const crackVal = crackMap ? crackMap[idx] : 0;
      if (crackVal === 1 && tileType === 'shore' && h % 4 === 0) {
        buf.setPixel(x0 + (h % 3), y0 + ((h >> 2) % 3), '#A69560');
      } else if (crackVal >= 2 && tileType === 'rock') {
        // Organic stepped ridge crease instead of repetitive stripes
        if (h % 2 === 0) {
          buf.setPixel(x0 + (h % 3), y0 + ((h >> 1) % 3), '#9A9EA6');
        }
        if (h % 5 === 0) {
          buf.setPixel(x0 + 1, y0 + 2, '#34363D');
        }
      }

      const rubbleVal = rubbleMap ? rubbleMap[idx] : 0;
      if (rubbleVal > 0) {
        buf.fillRect(x0 + 1, y0 + 1, 2, 2, rubbleVal === 2 ? '#5D5A61' : '#7A6853');
        buf.setPixel(x0 + (h % 3), y0 + 2, rubbleVal === 2 ? '#9C96A1' : '#3B322A');
      }
    }
  }

  drawAmbientSandboxFlora(buf, biome, tileMap, clearedFloraMask);
  return buf;
}

/**
 * Generates deterministic 640x360 2D Top-Down Backdrop:
 * - Smooth ocean depth bands + crisp coastal cyan shoreline rim
 * - Organic mottled 1-2px speckled terrain texture + crisp rock cliff ridges
 * - Dense borderless trees, autumn maples, crystal trees, mushrooms, flowers, & shadows
 */
export function renderBiomeBackdrop(biome: BiomeDefinition): PixelBuffer {
  return renderBiomeBackdropFromGrid(biome, buildBiomeTileGrid(biome.id));
}

/**
 * Pure deterministic 2D patrol + hover kinematics on the 640x360 top-down map.
 */
export function stepBiomePlacement(
  placement: BiomePlacement,
  model: PixelModelDef,
  timeSec: number
): SteppedEntity {
  const baseFacing: -1 | 1 = placement.facing ?? -1;
  let x = placement.x;
  let y = placement.y;
  let facing: -1 | 1 = baseFacing;

  if (placement.patrolSpan && placement.patrolSpan > 0 && placement.patrolSpeed) {
    const phase = timeSec * placement.patrolSpeed * Math.PI * 2 + (placement.phaseOffset ?? 0);
    const offsetX = Math.sin(phase) * placement.patrolSpan;
    const velocityX = Math.cos(phase);
    x = Math.max(24, Math.min(BIOME_WIDTH - 24, Math.round(placement.x + offsetX)));
    facing = velocityX >= 0 ? 1 : -1;

    if (placement.patrolSpanY && placement.patrolSpanY > 0) {
      const offsetY = Math.sin(phase * 2) * placement.patrolSpanY;
      y = Math.max(40, Math.min(BIOME_HEIGHT - 14, Math.round(placement.y + offsetY)));
    }
  }

  if (placement.hoverBob && placement.hoverBob > 0) {
    const bobPhase = timeSec * 2.2 + (placement.phaseOffset ?? 0);
    y = Math.round(y + Math.sin(bobPhase) * placement.hoverBob);
  }

  const drawX = Math.round(x - model.width / 2);
  const drawY = Math.round(y - model.height);

  return {
    placement,
    model,
    x,
    y,
    facing,
    drawX,
    drawY,
  };
}

export function hitTestBiomeEntities(
  entities: SteppedEntity[],
  biomeX: number,
  biomeY: number
): SteppedEntity | null {
  const layerOrder: Record<BiomeLayer, number> = {
    water: 0,
    ground: 1,
    air: 2,
    sky: 3,
  };

  const sorted = [...entities].sort((a, b) => {
    const la = layerOrder[a.placement.layer];
    const lb = layerOrder[b.placement.layer];
    if (la !== lb) return lb - la;
    return b.y - a.y;
  });

  const pad = 4;
  for (const ent of sorted) {
    if (ent.model.kind === 'weather') continue;
    const left = ent.drawX - pad;
    const right = ent.drawX + ent.model.width + pad;
    const top = ent.drawY - pad;
    const bottom = ent.drawY + ent.model.height + pad;
    if (biomeX >= left && biomeX <= right && biomeY >= top && biomeY <= bottom) {
      return ent;
    }
  }

  return null;
}

export function sortEntitiesForPaint(entities: SteppedEntity[]): SteppedEntity[] {
  const layerOrder: Record<BiomeLayer, number> = {
    water: 0,
    ground: 1,
    air: 2,
    sky: 3,
  };
  return [...entities].sort((a, b) => {
    const la = layerOrder[a.placement.layer];
    const lb = layerOrder[b.placement.layer];
    if (la !== lb) return la - lb;
    return a.y - b.y;
  });
}
