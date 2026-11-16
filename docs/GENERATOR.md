# Генератор спрайтов «Костяная Кузня» — Документация для передачи в игру

Документ описывает архитектуру процедурного генератора пиксель-арт спрайтов, единое игровое API (`src/engine/forgeApi.ts`), систему зональной перекраски, правила расширения контента, формат JSON-манифестов атласов, полные таблицы сущностей и набор автотестов.

---

## 1. Архитектура движка

### 1.1 Ключевые инварианты стиля
- **Без чёрной обводки (`0 INK`):** внешний контур цвета `#131110` запрещён на всех моделях и юнитах. Внутренние элементы разделяются методом `PixelBuffer.layer()` через затемнённый тон материала (`~58–66%` яркости базового материала).
- **Направление света `(-1, -1)`:** ключевой источник света всегда сверху-слева; каждая материальная рампа содержит 4 тона `[highlight, mid, shadow, deep]`.
- **100% непрозрачность внутри спрайта:** полупрозрачные пиксели допускаются только в мягкой тени под ногами (`applySoftGroundShadow`, `SHADOW_COLOR = #11102B66`) и в атмосферных VFX (`weather`).
- **Экономия цвета и чистота:** юниты `10×10` используют `≤ 8` уникальных цветов на кадр, имеют `0` изолированных однопиксельных артефактов (`orphanPixels = 0`) и детерминированы по `seed` (PRNG Mulberry32).

---

### 1.2 Слои сборки юнитов 10×10 (`PAPER_DOLL_LAYERS`)

Генератор `generateProceduralUnit` (`src/engine/proceduralHuman.ts` + `src/engine/proceduralRaces.ts`) собирает юнита строго в 9 последовательных слоёв на холсте `10×10`:

| № | Слой (`PaperDollLayer`) | Назначение |
| :-: | :--- | :--- |
| 1 | `body` | Базовый силуэт по расе, полу (`male`/`female`), возрасту (`child` 6–7 px / `adult` / `elder` 9–10 px) и фазе шага |
| 2 | `skin` | Нанесение кожи / хитина / чешуи с пометкой зоны `'skin'` и 4-тоновым освещением `(-1, -1)` |
| 3 | `faceEyes` | Глаза (1 px) и черты лица / светящиеся глаза кочевников / глазницы нежити |
| 4 | `hairBeard` | Причёска, рога, грива, гребень, костяные выросты, седина/борода старцев (`zone = 'hair'`) |
| 5 | `clothing` | Туника, балахон, юбка, плащ, набедренная шкура с тегами `k1` / `k2` |
| 6 | `armor` | Нагрудник, наплечники, щиты, боевая сбруя всадника, ростовые кристальные/костяные пластины |
| 7 | `headgear` | Капюшон, шлем, митра жреца, берет торговца, диадема/корона короля и королевы |
| 8 | `weaponTool` | Ролевое оружие/инструмент: вилы, молот, меч/трезубец/коса/копьё, лук, пика со стягом, посох, скипетр |
| 9 | `statusSign` | Знаки иерархии (в т.ч. знамя Лидера Альянса с цветом союзника `K2`) и состояния (`wounded`, `sick`, `zombie`, `possessed`, `captive`) |

> **Скрытый резерв шаблонных рас (`LEGACY_RESERVE_RACES`):** расы `'elf' | 'orc' | 'dwarf'` помечены `@deprecated` в `src/engine/proceduralHuman.ts`, исключены из `ACTIVE_UNIT_RACES` и оставлены только как скрытый совместимый резерв.

---

### 1.3 Точки привязки (Anchors)

Для юнитов `10×10` (`ProceduralAnchors` в `src/engine/proceduralHuman.ts`):
```ts
export interface ProceduralAnchors {
  readonly pivot: { readonly x: number; readonly y: number }; // (5, 9) — точка опоры на земле
  readonly head: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly face: { readonly x: number; readonly y: number };
  readonly belt: { readonly x: number; readonly y: number; readonly w: number };
  readonly hand: {
    readonly leftX: number;
    readonly leftY: number;
    readonly rightX: number;
    readonly rightY: number;
  };
  readonly feetY: number; // базовая линия ног (9)
}
```

Для полноразмерных моделей каталога (`UnitFrameAnchors` в `src/models/types.ts`):
- `pivot: { x, y }` — центр земли под объектом (используется тенью и сортировкой по Y);
- `head: { x, y, w, h }` — область головы/короны;
- `hand: { x, y }` — точка крепления оружия/эффекта;
- `back: { x, y }` — точка крепления плаща/крыльев.

---

### 1.4 Зоны перекраски `K1 / K2 / SKIN / HAIR`

#### Постройки, животные и модели каталога (`src/engine/palette.ts`)
| Зона | Маска исходных HEX-тонов (`[highlight, mid, shadow, deep]`) | Что перекрашивается |
| :--- | :--- | :--- |
| **`K1_MASK`** (основной цвет державы) | `#FF70FF`, `#D900EB`, `#9900A6`, `#5C0066` | Крыши, знамёна, туники, щиты, попоны |
| **`K2_MASK`** (вторичная отделка/союзник) | `#00EFEF`, `#00DBDB`, `#009E9E`, `#006666` | Гербы, отвороты, ленты, плюмажи, стяги альянса |
| **`SKIN_MASK`** (фенотип кожи) | `#B8FF96`, `#00FF00`, `#00AF00`, `#4A831F` | Открытая кожа гуманоидов в крупных моделях |
| **`WATER_LINE`** | `#D1E3EB`, `#D5E2EA` | Гребни волны в режиме плавания (`unitMode === 'swim'`) |

Формула генерации 4 тонов державы (`calculateKingdomRamp`):
если все RGB-каналы выбранного цвета `< 128`, к каждому каналу добавляется `+50` (Dark Clamp Rule), затем вычисляются 4 ступени интерполяции `Lerp(base, (30, 30, 30), t_i)`.

#### Юниты 10×10 (`zoneMap`)
Во время рендера 9 слоёв каждый непрозрачный пиксель `10×10` получает тег `ZoneTag`:
`'skin' | 'hair' | 'k1' | 'k2' | 'metal' | 'gold' | 'wood' | 'cloth' | 'status'`.
Это позволяет подсчитывать площадь каждой зоны (`audit.k1ZonePixels`, `audit.k2ZonePixels`, `audit.skinZonePixels`, `audit.hairZonePixels`) и перекрашивать юнитов без порчи металла, дерева или золота.

---

### 1.5 Палитры (`src/engine/palette.ts`, `src/engine/proceduralPalettes.ts`)
- **84 палитры держав (`KINGDOM_PALETTES_84`):** распределены в перцептивном пространстве **CIELAB (D65)** с минимальным расстоянием $\Delta E_{76} \ge 12$. Первые 6 составляют флагманский набор (`FLAGSHIP_SIX_KINGDOMS`): Алое Знамя, Лазурная Корона, Изумрудный Дол, Золотой Престол, Аметистовый Круг, Бирюзовый Флот.
- **14 палитр кожи (`SKIN_PALETTES_14`):** 11 естественных тонов человека + 3 неестественных тона (по 4 тона в каждой). Для оригинальных и доисторических рас заданы собственные 4-тоновые палитры кожи в `src/engine/proceduralRaces.ts` (по 3–4 варианта на расу).
- **12 палитр волос (`HAIR_PALETTES_12`):** естественные, рыжие, каштановые, тёмные, а также 2 оттенка седины (`isGrey: true`) для возраста `elder`.
- **22 материальные рампы (`RAMPS`):** `bone`, `slate`, `timber`, `sandstone`, `marble`, `obsidian`, `ice`, `moss`, `gold`, `lava`, `magenta`, `cyanMask`, `sail`, `sakura`, `autumn`, `pine`, `birch`, `copper`, `amethyst`, `storm`, `mist`, `emerald`.

---

## 2. Как расширять генератор (пошагово с примерами)

### 2.1 Как добавить новую расу
1. **Добавьте идентификатор и название** в `src/engine/proceduralHuman.ts`:
   - В `ActiveUnitRace` добавьте `'sand-weaver'`;
   - В `ACTIVE_UNIT_RACES` и `UNIT_RACE_LABELS` добавьте запись `'sand-weaver': 'Песчаные ткачи'`.
2. **Задайте палитры кожи и геометрию силуэта** в `src/engine/proceduralRaces.ts`:
   - В `CUSTOM_RACE_SKIN_PALETTES` добавьте 3–4 4-тоновых палитры;
   - В `isCustomSilhouetteRace()` включите `'sand-weaver'`;
   - В `renderCustomRaceLayers()` опишите ветку отрисовки для `isChild` (`6–7 px`) и взрослых (`adult`/`elder`), учитывая `isFemale`, `strideL/R` и затем вызывая `applyCustomRoleEquipment(...)` (для поддержки всех 11 ролей и 5 рангов власти).
3. **Проверьте уникальность силуэта (≥ 15% попарно на маске 10×10):**
   ```ts
   // Пример проверки новой расы в тесте
   const unit = getUnitSprite(4444, { race: 'sand-weaver', role: 'warrior', age: 'adult' });
   assert.equal(unit.audit.inkPixels, 0);
   assert.equal(unit.audit.orphanPixels, 0);
   ```

### 2.2 Как добавить новую роль
1. Добавьте ключ роли в `MedievalHumanRole` и `MEDIEVAL_ROLE_LABELS` в `src/engine/proceduralHuman.ts`.
2. В `renderRoleClothingAndArmor` и `renderRoleHeadgearAndWeapon` (для людей), а также в `applyCustomRoleEquipment` в `src/engine/proceduralRaces.ts` (для остальных ролевых рас, кроме безролевого `hive-mind`) добавьте отличительный элемент экипировки (головной убор, броня, оружие/инструмент) без использования цвета `INK`.
3. Обновите `ALL_ROLES` в тестах (`proceduralHuman.test.ts` и `proceduralStage2.test.ts`).

### 2.3 Как добавить новую постройку
Используйте `PixelBuffer.layer()` и маски `K1_MASK` / `K2_MASK` + обёртку состояний `applyBuildingState`:
```ts
import { applyBuildingState } from './buildingStates';
import { K1_MASK, K2_MASK, RAMPS } from './palette';
import { PixelBuffer } from './pixelCanvas';
import type { PixelModelDef } from '../models/types';

export const NEW_WATCH_BASTION: PixelModelDef = {
  id: 'new-watch-bastion',
  name: 'Сторожевой бастион',
  subtitle: 'Средневековье · Оборона',
  kind: 'static',
  tier: 'II',
  era: 'medieval',
  entityType: 'building',
  buildingFunction: 'defense',
  supportsBuildingStates: true,
  faction: 'Цитадель',
  width: 36,
  height: 36,
  frameCount: 4,
  defaultFps: 5,
  layersSpec: ['0. Основа', '1. Кладка', '2. Маски K1/K2'],
  description: 'Бастион с перекрашиваемой кровлей K1 и флагом K2.',
  renderFrame: (frame, total, ctx) => {
    const buf = new PixelBuffer(36, 36);
    buf.layer((b) => {
      b.fillRect(8, 14, 20, 18, RAMPS.slate.mid);
      b.fillRect(8, 14, 7, 18, RAMPS.slate.highlight);
      b.fillRect(21, 14, 7, 18, RAMPS.slate.shadow);
    });
    buf.layer((b) => {
      b.fillRect(6, 10, 24, 4, K1_MASK[1]);
      b.fillRect(6, 10, 10, 2, K1_MASK[0]);
      b.fillRect(16, 16, 4, 5, K2_MASK[0]);
    });
    return applyBuildingState(buf, ctx?.buildingState ?? 'ready', frame, total);
  },
  codeSnippet: '// new-watch-bastion',
};
```
Чтобы включить постройку в матрицу расы, добавьте её в соответствующую группу в `RACE_ARCHITECTURE_GROUPS` (`src/engine/proceduralRaceBuildings.ts`), или для основного каталога — в `src/models/eraStructures.ts` (при добавлении в `ALL_MODELS` обновите счётчики в `pixelCanvas.test.ts` и `proceduralStage2.test.ts`).

### 2.4 Как добавить новый вид животного / существа
1. Опишите модель `PixelModelDef` с поддержкой `unitAction` (`idle`, `normal`, `attack`, `death`) и `unitMode` (`walk`, `swim` с отсечением ниже `WATER_LINE`) в `src/models/eraDinosaurs.ts`, `eraMegafauna.ts`, `eraPrimordial.ts` или `wildlifeCreatures.ts`.
2. Если у существа есть упряжь/ошейник державы — используйте `K1_MASK` / `K2_MASK`.
3. Движок генов (`src/engine/genes.ts`) и реестр фенотипов (`src/engine/phenotypeRegistry.ts`) автоматически поддержат мутации:
   - `coat`: `'natural' | 'dark' | 'albino' | 'striped'`
   - `pattern`: `'solid' | 'striped' | 'spotted' | 'dappled'`
   - `size`: `'compact' | 'standard' | 'colossal'`
   - `biomeTint`: `'none' | 'forest' | 'tundra' | 'desert' | 'volcanic'`
   - `appendages`: `'none' | 'standard' | 'ornate'`
4. При желании задайте явную запись в `EXPLICIT_ZONE_OVERRIDES` в `src/engine/phenotypeRegistry.ts`.

---

## 3. Публичный API для игры (`src/engine/forgeApi.ts`)

```ts
import {
  getUnitSprite,
  getBuildingSprite,
  getCreatureSprite,
  bakeAtlas,
  buildFullExportArchive,
} from './src/engine/forgeApi';

// 1. Процедурный юнит 10×10
const hero = getUnitSprite(1042, {
  era: 'medieval',
  race: 'stonekin',
  gender: 'female',
  age: 'adult',
  role: 'warrior',
  powerRank: 'city-lord',
  kingdomId: 2,
});
// hero.rgba -> Uint8ClampedArray (10 * 10 * 4), hero.anchors, hero.zoneMap, hero.audit

// 2. Постройка с цветом державы (0..83, имя, 'red'..'cyan', 'original') и состоянием
const hall = getBuildingSprite('medieval-town-hall', 3, 'ready');
const hutDamaged = getBuildingSprite('marsh-stilt-hut', 'blue', 'damaged');

// 3. Животное / существо с генотипом CreatureGenes
const wolf = getCreatureSprite('dire-wolf', {
  coat: 'albino',
  pattern: 'spotted',
  size: 'colossal',
  biomeTint: 'tundra',
  appendages: 'ornate',
});

// 4. Запекание произвольного списка в PNG + JSON-манифест
const { png, json, manifest, pages } = bakeAtlas(
  [
    { kind: 'unit', seed: 100, params: { race: 'antlerfolk', role: 'archer' } },
    { kind: 'building', id: 'medieval-town-hall', kingdom: 1, state: 'ready' },
    { kind: 'creature', species: 'tyrannosaurus-rex', genes: { coat: 'striped', pattern: 'striped' } },
  ],
  { scale: 2, pageSize: 1024 }
);

// 5. Полный экспорт всего проекта одним ZIP-архивом (PNG + JSON)
const zip = buildFullExportArchive({ scale: 1 });
```

---

## 4. Формат JSON-манифеста атласа

### 4.1 Манифест универсального `bakeAtlas()` (`ForgeAtlasManifest`)
```ts
export interface ForgeAtlasManifest {
  readonly version: string;        // '2.0.0'
  readonly generator: string;      // 'Kostyanaya Kuznya Public Forge API'
  readonly scale: number;          // 1 | 2 | 4
  readonly pageSize: number;       // размер страницы (например, 1024 или 2048)
  readonly atlasStats: {
    readonly pageSize: number;
    readonly pagesCount: number;
    readonly bakedFrames: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
    readonly fillRatio: number;
  };
  readonly totalFrames: number;
  readonly pages: readonly {
    readonly pageIndex: number;
    readonly width: number;
    readonly height: number;
  }[];
  readonly frames: readonly {
    readonly key: string;          // уникальный ключ кадра
    readonly kind: 'unit' | 'building' | 'creature' | 'buffer';
    readonly pageIndex: number;
    readonly x: number;            // X на странице PNG (в пикселях)
    readonly y: number;            // Y на странице PNG (в пикселях)
    readonly width: number;        // ширина кадра с учётом scale
    readonly height: number;       // высота кадра с учётом scale
    readonly meta: Record<string, unknown>; // якоря, раса, эпоха, гены, К1/К2
  }[];
}
```

### 4.2 Манифест пакетного генератора юнитов (`ProceduralAtlasManifest`, `packProceduralAtlasBatch`)
```ts
export interface ProceduralAtlasManifest {
  readonly version: string;        // '1.0.0'
  readonly generator: string;
  readonly tileSize: { readonly width: number; readonly height: number }; // 10×10
  readonly atlasStats: AtlasStats;
  readonly summary: {
    readonly totalFrames: number;
    readonly eras: readonly UnitEra[];
    readonly races: readonly UnitRace[];
    readonly maxColorsObserved: number; // <= 8
    readonly totalOrphanPixels: number; // 0
  };
  readonly frames: readonly {
    readonly key: string;
    readonly pageIndex: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly seed: number;
    readonly era: UnitEra;
    readonly race: UnitRace;
    readonly gender: UnitGender;
    readonly age: UnitAge;
    readonly role: MedievalHumanRole;
    readonly powerRank: PowerHierarchyRank;
    readonly status: UnitStatus;
    readonly frameIndex: number;
    readonly kingdom: {
      readonly id: number;
      readonly name: string;
      readonly primaryHex: string;
      readonly secondaryHex: string;
    };
    readonly skin: { readonly id: number; readonly name: string };
    readonly hair: { readonly id: number; readonly name: string };
    readonly anchors: ProceduralAnchors;
    readonly zones: {
      readonly k1: number;
      readonly k2: number;
      readonly skin: number;
      readonly hair: number;
    };
    readonly audit: {
      readonly uniqueColors: number;
      readonly opaquePixels: number;
      readonly orphanPixels: number;
    };
  }[];
}
```

---

## 5. Полные таблицы: Эпохи → Расы → Постройки → Животные и Модели

### 5.1 Процедурные расы, роли, ранги и статусы
- **Активные расы (10):**
  1. `human` — Человек
  2. `marshfolk` — Болотный народ *(оригинальная)*
  3. `stonekin` — Каменнокожие *(оригинальная)*
  4. `antlerfolk` — Лесной рогатый народ *(оригинальная)*
  5. `ash-nomads` — Пепельные кочевники *(оригинальная)*
  6. `undead` — Нежить *(перерисованная)*
  7. `demon` — Демоны *(перерисованная)*
  8. `neanderthal` — Неандертальцы и Денисовцы *(Ледниковый период)*
  9. `raptor-kin` — Ящеры-рапторы *(Эра динозавров)*
  10. `hive-mind` — Улей-Разум *(Первобытная жизнь, особое существо без ролей)*
- **Скрытый резерв (3):** `elf`, `orc`, `dwarf`.
- **Роли (11):** `peasant`, `worker`, `warrior`, `archer`, `cavalry`, `cleric`, `merchant`, `settlement-leader`, `heir`, `king`, `queen`.
- **Иерархия власти (5):** `none`, `village-leader`, `city-lord`, `king`, `alliance-leader`.
- **Состояния (6):** `healthy`, `wounded`, `sick`, `zombie`, `possessed`, `captive`.

### 5.2 Уникальная архитектура рас (`ALL_RACE_BUILDINGS`: 8 рас × 3 = 24 постройки + Ратуша)
| Раса / Назначение | Постройки (`id` и название) |
| :--- | :--- |
| **Болотный народ** (`marshfolk`) | `marsh-stilt-hut` (Свайная хижина), `marsh-gill-totem` (Тотем жабр), `marsh-spawning-pool` (Заводь-питомник) |
| **Каменнокожие** (`stonekin`) | `stonekin-monolith` (Кристальный монолит), `stonekin-forge` (Базальтовая кузня), `stonekin-bastion` (Рунный бастион) |
| **Лесной рогатый** (`antlerfolk`) | `antler-living-grove` (Живое древо-роща), `antler-horn-shrine` (Храм ветвистых рогов), `antler-watchtree` (Лесная застава) |
| **Пепельные кочевники** (`ash-nomads`) | `ash-nomad-tent` (Пепельный шатёр), `ash-cinder-hearth` (Обсидиановый очаг), `ash-mirage-tower` (Башня миражей) |
| **Нежить** (`undead`) | `undead-ossuary` (Склеп-оссуарий), `undead-obelisk` (Некро-обелиск), `undead-bone-spire` (Башня костяного праха) |
| **Демоны** (`demon`) | `demon-hellgate` (Врата пекла), `demon-brimstone-altar` (Алтарь серного пламени), `demon-horn-keep` (Бастион рогов) |
| **Неандертальцы и Денисовцы** (`neanderthal`) | `neanderthal-tusk-lodge` (Мамонтовый чум из бивней), `neanderthal-hearth-cave` (Пещерное кострище), `neanderthal-ice-cache` (Ледяная кладовая) |
| **Ящеры-рапторы** (`raptor-kin`) | `raptor-egg-nest` (Кладка-гнездо ящеров), `raptor-bone-roost` (Костяной насест стаи), `raptor-crag-outpost` (Смотровая скала стаи) |
| **Средневековье (дополн.)** | `medieval-town-hall` (Ратуша Королевства) |

### 5.3 Все 205 моделей основного каталога по эпохам (`ALL_MODELS`)
| Эпоха | Расы / Представители | Постройки (`building`) | Животные, существа, юниты и природа (`creature` / `unit` / `nature`) |
| :--- | :--- | :--- | :--- |
| **`primordial`** (Первобытная жизнь, 9) | `hive-mind` (Улей-Разум) | *(построек нет)* | **Существа (6):** `dunkleosteus`, `eurypterid-king`, `trilobite`, `meganeura`, `arthropleura`, `diplocaulus`<br>**Природа (3):** `coral-reef-colony`, `primordial-stromatolite`, `primordial-tree-fern` |
| **`dinosaurs`** (Динозавры, 19) | `raptor-kin` (Ящеры-рапторы) | *(+ 3 гнезда/стоянки стаи в `ALL_RACE_BUILDINGS`)* | **Существа (14):** `mosasaurus`, `liopleurodon`, `xiphactinus`, `elasmosaurus`, `tyrannosaurus-rex`, `dino-pack-compy`, `dino-feathered-raptor`, `dino-sauropod`, `dino-triceratops`, `dino-ankylosaurus`, `dino-pteranodon`, `dino-plesiosaur`, `dino-spinosaurus`, `dino-stegosaurus`<br>**Природа (5):** `amber-fossil-pillar`, `dino-egg-nest`, `dino-egg-clutch`, `dino-giant-fern`, `dino-fossil-ribcage` |
| **`ice-age`** (Кайнозой и Ледниковье, 12) | `neanderthal` (Неандертальцы и Денисовцы) | `ice-campfire`, `ice-hide-shelter`, `ice-mammoth-hut` *(+ 3 ледниковых постройки расы)* | **Существа (9):** `livyatan`, `basilosaurus`, `megalodon`, `mega-mammoth`, `mega-woolly-rhino`, `mega-sabertooth`, `mega-cave-bear`, `mega-giant-deer`, `mega-glyptodon` |
| **`stone-age`** (Каменный век, 18) | `human` (Племена) | `mossy-dolmen`, `stone-wigwam-hut`, `stone-dugout`, `stone-hearth-pit`, `stone-totem-pole`, `stone-menhir`, `stone-circle-sanctuary`, `stone-palisade`, `stone-animal-pen`, `stone-cave-dwelling`, `stone-shaman-altar` | **Существа (1):** `stone-tamed-wolf`<br>**Юниты (6):** `stone-hunter`, `stone-chieftain`, `stone-shaman`, `stone-gatherer`, `stone-child`, `stone-slinger` |
| **`bronze-iron`** (Бронза и железо, 17) | `human`, `ash-nomads`, `stonekin` | `obsidian-ziggurat`, `bronze-mudbrick-house`, `bronze-granary`, `bronze-furnace-smithy`, `bronze-pottery-kiln`, `bronze-ziggurat-shrine`, `bronze-timber-gate`, `bronze-watchtower`, `bronze-stone-well`, `bronze-wooden-pier` | **Юниты (7):** `dune-sunpriest`, `bronze-spearman`, `bronze-archer`, `bronze-chariot`, `bronze-king`, `bronze-smith`, `bronze-merchant` |
| **`medieval`** (Средневековье, 27 + Ратуша) | `human`, `marshfolk`, `stonekin`, `antlerfolk`, `ash-nomads`, `undead`, `demon` | `guild-watermill`, `citadel-keep`, `ironclad-armory`, `grand-cathedral`, `harbor-bastion`, `watchtower-t1`, `medieval-stone-house`, `medieval-tavern`, `medieval-smithy`, `medieval-windmill`, `medieval-church`, `medieval-castle-walls`, `medieval-archer-tower`, `medieval-barracks`, `medieval-market`, `medieval-port` *(+ `medieval-town-hall`)* | **Юниты (11):** `peasant-militia`, `paladin-knight`, `faction-king`, `alliance-monarch`, `lotus-samurai`, `war-galleon`, `siege-catapult`, `medieval-peasant`, `medieval-archer`, `medieval-cavalry`, `medieval-monk` |
| **`wildlife`** (Дикая природа, 6) | — | — | **Существа (6):** `dire-wolf`, `gustave-crocodile`, `wild-boar`, `forest-stag`, `brown-bear`, `steppe-eagle` |
| **`common-nature`** (Общая природа, руды и погода, 37) | — | — | **Природа, руды, стихии и погода (37):** `berry-bush`, `thorn-briar`, `desert-scrub`, `frost-holly`, `fungal-cluster`, `ancient-oak`, `nordic-pine`, `sakura-tree`, `weeping-willow`, `autumn-maple`, `oasis-palm`, `bamboo-grove`, `crystal-geode`, `glacier-ice-spire`, `molten-basalt-vent`, `gold-quartz-vein`, `bismuth-hopper-crystal`, `ore-stone-deposit`, `ore-iron-deposit`, `ore-silver-deposit`, `ore-mythril-deposit`, `ore-adamantine-deposit`, `ore-ruby-gem-deposit`, `acid-geyser`, `weather-rain`, `weather-thundercloud`, `weather-cumulus-cloud`, `weather-fog-bank`, `weather-blizzard`, `weather-sandstorm`, `vfx-tornado`, `vfx-dust-devil`, `vfx-mega-tornado`, `vfx-earthquake-rift`, `vfx-firestorm`, `vfx-arcane-aurora`, `vfx-water-geyser` |
| **`mythic`** (Мифические и фэнтези, 60) | `undead`, `demon`, `marshfolk`, `stonekin`, `antlerfolk`, `ash-nomads` | `brass-steam-boiler`, `bone-windmill`, `arcane-spire`, `infernal-forge`, `guild-clocktower`, `sky-galleon-dock`, `titan-foundry`, `summoning-obelisk`, `alchemist-lab`, `frost-beacon`, `druid-totem-mill`, `hellfire-portal`, `bone-ossuary`, `druid-shrine`, `glacier-bastion`, `necro-citadel-t3`, `elder-grove-t3`, `orc-war-camp-t1` | **Существа (20):** `leviathan`, `kraken`, `river-monster`, `slime-cube`, `iron-golem`, `forest-treant`, `crystal-elemental`, `frost-yeti`, `bone-wyvern`, `mech-spider`, `magma-colossus`, `elder-dragon`, `distortus-rex`, `shadow-panther`, `spore-hydra`, `scarab-colossus`, `lava-salamander`, `plague-griffon`, `abyssal-reaper`, `clockwork-rhino`<br>**Юниты (19):** `goblin-scout`, `orc-raider`, `orc-warlord`, `skeleton-levy`, `necromancer-acolyte`, `lich-archmage`, `forest-ranger`, `frost-warden`, `demon-imp`, `dwarf-runesmith`, `plague-alchemist`, `ether-chronomancer`, `sky-aviator`, `abyssal-corsair`, `dawn-valkyrie`, `stag-druid`, `inferno-executioner`, `phantom-assassin`, `cyber-warden`<br>**Природа (3):** `mana-shrub`, `blighted-deadwood`, `obsidian-monolith` |

---

## 6. Реестр всех автотестов (52 теста, `npx tsx --test src/engine/*.test.ts`)

### `src/engine/pixelCanvas.test.ts` (25 тестов)
1. `PixelBuffer.layer()` — изоляция слоёв затемнением материала без `INK`.
2. `Kingdom Lerp & Skin Phenotype` — математика 4-тоновых рамп и фенотипов кожи.
3. `Dynamic mask recoloring & zombie transform` — перекраска масок `K1/K2` и зомби-морф.
4. `filterModels partitions all 7 collections, 9 eras, and 4 entity types (205 total)` — инвариант каталога из 205 моделей.
5. `All 56 structures render borderless` — все 56 структур без `INK` и плотностью ≥ 500 px.
6. `All 20 nature & 17 substance models` — природа и вещества без чёрных контуров.
7. `All 13 weather & atmospheric VFX models` — прозрачные альфа-частицы без тени.
8. `All 13 aquatic monsters` — плавание в `WATER_LINE`, многофазные атаки и `K1/K2`.
9. `All 86 units & creatures` — анимация, якоря, тени, `WATER_LINE` и перекраска.
10. `Shape-based soft shadows` — мягкая тень по силуэту на всех фонах `stageBg`.
11. `Every model exports valid standalone .ts and .json` — экспорт кода и JSON для моделей.
12. `Distortus rex boss` — 20 кадров, 4-фазная атака, плавание, отступы.
13. `All 7 BIOME_CREATURE_MODELS` — существа биомов и их состояния.
14. `All 5 biomes populate structures...` — симуляция 5 биомов и hit-testing.
15. `PixelSandbox 2D sprite adapter` — адаптер без рамок и обрезка водных боксов.
16. `Gustave crocodile boss` — босс 64×36 и атака Death Roll.
17. `Geological ore deposits, Acid Geyser, 3 Tornadoes & Earthquake` — руды и стихийные бедствия.
18. `Interactive biomeSimulation` — землетрясения изменяют тайлы и ломают постройки.
19. `Alliance Monarch (alliance-monarch)` — монарх 40×38, `K1+K2+SKIN` и 12 кадров ореола.
20. `Tyrannosaurus rex` — тираннозавр 68×52 и атака.
21. `All Era species, human era units, and Wildlife animals` — существа эпох, `CreatureGenes`, 0 `INK`.
22. `BakedSpriteAtlas` — упаковка на листы `1024×1024` и >20 000 обращений к кэшу.
23. `Strict 9-era classification & EntityType filter` — строгая классификация без анахронизмов.
24. `All 58 buildings support 4 distinct states` — все 58 построек поддерживают 4 состояния.
25. `Primordial fauna & upgraded aquatic predators` — доисторическая фауна без `INK`.

### `src/engine/humanDiversity.test.ts` (5 тестов)
26. Точный размер каталога эталонной системы людей (35 тел, 47 голов, 10 культур, 88 цветов, 52 кожи × 4).
27. Микро-пропорции `10×10` на холсте `12×12`, тень `7×3`.
28. Независимая смена всех 6 слоёв, культур, 8 ролей и состояний.
29. Наследование кожи ребёнка строго от родителя A или B.
30. Симулятор толпы из 24 человек на карте `240×112`.

### `src/engine/proceduralHuman.test.ts` (6 тестов)
31. **Палитры:** 84 цвета держав (`min CIELAB ΔE ≥ 12`), 14 палитр кожи и 12 палитр волос (вкл. седину).
32. **Пайплайн paper-doll:** порядок 9 слоёв, детерминизм по `seed`, рост ребёнка (`6–7 px`) и взрослого (`9–10 px`).
33. **Иерархия власти и 11 ролей:** все 11 ролей и 5 рангов образуют разные силуэты.
34. **Зональная перекраска:** перекраска `K1/K2/skin/hair` не затрагивает сталь и дерево.
35. **Строгий аудит спрайтов:** `≤ 8` цветов, `0` полупрозрачных пикселей, `0 INK`, `0` сирот-пикселей.
36. **Бенчмарк:** генерация 10 000 уникальных юнитов в `BakedSpriteAtlas`.

### `src/engine/proceduralStage2.test.ts` (11 тестов)
37. **6 эпох** (включая первобытную, динозавров и ледниковье) с уникальными силуэтами.
38. **10 активных рас:** попарное отличие монохромной маски 10×10 `≥ 15%` (все 45 пар).
39. **Улей-Разум:** полная роленезависимость при сохранении возраста, иерархии матки и цветов королевства.
40. **Исчерпывающий аудит:** 6 эпох × 10 рас × роли × возраст × пол × статусы (`0 INK`, `0` сирот, `≤ 8` цветов).
41. **Архитектура рас:** все 8 рас × 3 постройки (24 здания) перекрашиваются в 6 королевств без `INK`.
42. **Все 26 построек Средневековья и Бронзы:** перекраска по `K1/K2` в 6 королевств и 4 состояния.
43. **Универсальные фенотипы всех 205 моделей:** у каждой `≥ 8` различимых вариантов; `5 × 12` (волк, мамонт, тираннозавр, акула, медведь) с `IoU ≥ 0.45`.
44. **Генные мутации животных:** окрас (`coat`), узор (`pattern`), размер (`size`) и биом (`biomeTint`).
45. **Атлас и JSON-экспорт:** упаковка 180 юнитов без наложений с якорями.
46. **Единая система для всех кастомных рас:** пол, возраст, 11 ролей, 5 рангов и `≥ 15%` отличие женских силуэтов.
47. **Ратуша Королевства (`medieval-town-hall`):** перекраска в 6 королевств и 4 состояния без `INK`.

### `src/engine/forgeApi.test.ts` (5 тестов)
48. `getUnitSprite`: детерминизм, размеры `10×10`, 400 байт RGBA, якоря и аудит.
49. `getBuildingSprite`: каталог + постройки рас + Ратуша + 84 державы + 4 состояния.
50. `getCreatureSprite`: применение `CreatureGenes` и сбруи державы без `INK`.
51. `bakeAtlas`: упаковка смешанного списка (`unit`, `building`, `creature`, `buffer`) в валидный PNG (проверка `IHDR`/`IDAT` через `zlib.inflateSync`) и JSON.
52. `buildFullExportArchive`: сборка полного ZIP-архива (`PK\x03\x04`) со всеми расами, постройками и 205 моделями.
