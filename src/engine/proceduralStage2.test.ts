import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_MODELS } from '../models';
import { BuildingState, GeneBiomeTint, GeneCoat, GenePattern } from '../models/types';
import {
  FIVE_SHOWCASE_SPECIES,
  generateDistinctModelVariants,
  getAllModelPhenotypeSchemas,
} from './phenotypeRegistry';
import {
  FLAGSHIP_SIX_KINGDOMS,
  ProceduralAtlasManifest,
  SHOWCASE_ANIMAL_IDS,
  generateAnimalPhenotypeVariant,
  generateBuildingSixKingdomVariants,
  getAllMedievalAndBronzeBuildings,
  packProceduralAtlasBatch,
} from './proceduralBuildingsAndAnimals';
import {
  ACTIVE_UNIT_ERAS,
  ACTIVE_UNIT_RACES,
  ActiveUnitRace,
  MEDIEVAL_ROLE_LABELS,
  MedievalHumanRole,
  POWER_RANK_LABELS,
  PowerHierarchyRank,
  UnitAge,
  UnitGender,
  UnitStatus,
  generateProceduralMultiEraRaceGrid,
  generateProceduralUnit,
} from './proceduralHuman';
import {
  ALL_RACE_BUILDINGS,
  MEDIEVAL_TOWN_HALL,
  RACE_ARCHITECTURE_GROUPS,
} from './proceduralRaceBuildings';
import { PixelBuffer } from './pixelCanvas';

function signature(buf: PixelBuffer): string {
  const rows: string[] = [];
  for (let y = 0; y < buf.height; y++) {
    const cols: string[] = [];
    for (let x = 0; x < buf.width; x++) {
      cols.push(buf.getPixel(x, y) ?? '.');
    }
    rows.push(cols.join(','));
  }
  return rows.join('|');
}

const ALL_ROLES = Object.keys(MEDIEVAL_ROLE_LABELS) as MedievalHumanRole[];
const ALL_STATUSES: readonly UnitStatus[] = ['healthy', 'wounded', 'sick', 'zombie', 'possessed', 'captive'];

test('Stage 2 Eras: all 6 eras (incl. primordial, dinosaurs, ice-age) generate distinct units with 0 INK & 0 orphans', () => {
  assert.equal(ACTIVE_UNIT_ERAS.length, 6);
  const eraSigs = new Set<string>();

  for (const era of ACTIVE_UNIT_ERAS) {
    // Auto race picks era-native species for primordial/dinosaurs/ice-age and human/original for later eras
    const res = generateProceduralUnit({
      seed: 2025,
      era,
      race: era === 'stone-age' || era === 'bronze-iron' || era === 'medieval' ? 'human' : 'auto',
      gender: 'male',
      age: 'adult',
      role: 'warrior',
      kingdomId: 0,
      skinId: 2,
      hairId: 1,
      status: 'healthy',
      frameIndex: 0,
    });
    eraSigs.add(signature(res.buffer));
    assert.ok(res.audit.uniqueColors <= 8, `${era} exceeded 8 colors`);
    assert.equal(res.audit.inkPixels, 0, `${era} has INK pixels`);
    assert.equal(res.audit.orphanPixels, 0, `${era} has orphan pixels`);
  }

  assert.equal(eraSigs.size, 6, 'All 6 eras must yield visually distinct unit silhouettes');
});

test('Stage 2 Original Races: all 10 active races differ pairwise by >= 15% on monochrome 10x10 opaque mask', () => {
  assert.equal(ACTIVE_UNIT_RACES.length, 10);
  const masks = new Map<ActiveUnitRace, boolean[]>();

  for (const race of ACTIVE_UNIT_RACES) {
    const res = generateProceduralUnit({
      seed: 4444,
      era: 'medieval',
      race,
      gender: 'male',
      age: 'adult',
      role: 'warrior',
      kingdomId: 1,
      hairId: 3,
      status: 'healthy',
      frameIndex: 0,
    });
    assert.equal(res.audit.inkPixels, 0, `Race ${race} must have 0 INK`);
    assert.equal(res.audit.orphanPixels, 0, `Race ${race} must have 0 orphan pixels`);
    assert.ok(res.audit.uniqueColors <= 8, `Race ${race} must stay <= 8 colors`);

    const mask: boolean[] = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        mask.push(res.buffer.getPixel(x, y) !== null);
      }
    }
    masks.set(race, mask);
  }

  // Pairwise symmetric difference / union >= 15% for ALL 45 pairs
  for (let i = 0; i < ACTIVE_UNIT_RACES.length; i++) {
    for (let j = i + 1; j < ACTIVE_UNIT_RACES.length; j++) {
      const ra = ACTIVE_UNIT_RACES[i];
      const rb = ACTIVE_UNIT_RACES[j];
      const ma = masks.get(ra)!;
      const mb = masks.get(rb)!;
      let diff = 0;
      let union = 0;
      for (let k = 0; k < 100; k++) {
        if (ma[k] || mb[k]) union++;
        if (ma[k] !== mb[k]) diff++;
      }
      const pct = union > 0 ? (diff / union) * 100 : 0;
      assert.ok(
        pct >= 15,
        `Pair ${ra} vs ${rb} monochrome mask difference is ${pct.toFixed(1)}% (< 15%)`
      );
    }
  }
});

test('Stage 2 Hive-Mind: primordial hive-mind is roleless while varying by age, hierarchy, status, and kingdom', () => {
  const peasant = generateProceduralUnit({
    seed: 910,
    era: 'primordial',
    race: 'hive-mind',
    age: 'adult',
    role: 'peasant',
    powerRank: 'none',
    kingdomId: 0,
    status: 'healthy',
    frameIndex: 0,
  });
  const warrior = generateProceduralUnit({
    seed: 910,
    era: 'primordial',
    race: 'hive-mind',
    age: 'adult',
    role: 'warrior',
    powerRank: 'none',
    kingdomId: 0,
    status: 'healthy',
    frameIndex: 0,
  });
  const child = generateProceduralUnit({
    seed: 910,
    era: 'primordial',
    race: 'hive-mind',
    age: 'child',
    role: 'warrior',
    powerRank: 'none',
    kingdomId: 0,
    status: 'healthy',
    frameIndex: 0,
  });
  const matriarch = generateProceduralUnit({
    seed: 910,
    era: 'primordial',
    race: 'hive-mind',
    age: 'adult',
    role: 'peasant',
    powerRank: 'alliance-leader',
    kingdomId: 0,
    alliedKingdomId: 2,
    status: 'healthy',
    frameIndex: 0,
  });

  assert.equal(
    signature(peasant.buffer),
    signature(warrior.buffer),
    'Hive-mind must ignore role changes and remain roleless'
  );
  assert.notEqual(
    signature(child.buffer),
    signature(peasant.buffer),
    'Hive-mind must still vary by age (bud vs colony)'
  );
  assert.notEqual(
    signature(matriarch.buffer),
    signature(peasant.buffer),
    'Hive-mind must still display matriarch hierarchy crest'
  );
});

test('Stage 2 Exhaustive Audit: 6 eras × 10 active races × roles × ages × genders × statuses obey <= 8 colors, 0 INK, 0 orphans', () => {
  const ages: readonly UnitAge[] = ['child', 'adult', 'elder'];
  const genders: readonly UnitGender[] = ['male', 'female'];
  let totalChecked = 0;

  for (const era of ACTIVE_UNIT_ERAS) {
    for (const race of ACTIVE_UNIT_RACES) {
      for (const role of ALL_ROLES) {
        const age = ages[totalChecked % ages.length];
        const gender = genders[totalChecked % genders.length];
        const status = ALL_STATUSES[totalChecked % ALL_STATUSES.length];
        for (const frameIndex of [0, 1]) {
          const res = generateProceduralUnit({
            seed: 9000 + totalChecked,
            era,
            race,
            age,
            gender,
            role,
            status,
            kingdomId: totalChecked % 84,
            frameIndex,
          });
          totalChecked++;
          assert.ok(
            res.audit.uniqueColors <= 8,
            `${era}/${race}/${role}/${age}/${status}/f${frameIndex} used ${res.audit.uniqueColors} colors`
          );
          assert.equal(res.audit.semitransparentPixels, 0, 'Zero semitransparent pixels');
          assert.equal(res.audit.inkPixels, 0, 'Zero INK black pixels');
          assert.equal(
            res.audit.orphanPixels,
            0,
            `${era}/${race}/${role}/${age}/${status}/f${frameIndex} produced orphan pixels`
          );
        }
      }
    }
  }

  const grid = generateProceduralMultiEraRaceGrid(5050, 100);
  assert.equal(grid.length, 100);
  for (const item of grid) {
    assert.ok(item.audit.uniqueColors <= 8);
    assert.equal(item.audit.orphanPixels, 0);
    assert.equal(item.audit.inkPixels, 0);
  }
  assert.ok(totalChecked >= 1300, `Checked ${totalChecked} multi-era/race frames`);
});

test('Stage 2 Race Architecture: all 8 sentient/prehistoric races have >= 3 K1/K2 recolorable buildings with 0 INK', () => {
  assert.equal(RACE_ARCHITECTURE_GROUPS.length, 8);
  assert.equal(ALL_RACE_BUILDINGS.length, 24);

  for (const group of RACE_ARCHITECTURE_GROUPS) {
    assert.ok(group.buildings.length >= 3, `${group.raceId} must have at least 3 buildings`);
    for (const b of group.buildings) {
      const variants = generateBuildingSixKingdomVariants(b, 'ready', FLAGSHIP_SIX_KINGDOMS, 'dark', 0);
      assert.equal(variants.length, 6);
      const sigs = new Set(variants.map((v) => signature(v.buffer)));
      assert.equal(sigs.size, 6, `Race building ${b.id} must recolor into 6 distinct kingdom sprites`);
      for (const v of variants) {
        assert.equal(v.inkPixels, 0, `Race building ${b.id} must have 0 INK`);
        assert.ok(v.k1ChangedPixels > 0, `Race building ${b.id} must expose K1 mask pixels`);
      }
    }
  }
});

test('Stage 2 ALL 26 Medieval & Bronze Buildings in 6 Kingdoms: every building recolors across 6 kingdoms & 4 states', () => {
  const medBronze = getAllMedievalAndBronzeBuildings(ALL_MODELS);
  assert.equal(medBronze.length, 26, 'Expected 16 medieval + 10 bronze-iron = 26 buildings');

  for (const model of medBronze) {
    const variants = generateBuildingSixKingdomVariants(model, 'ready', FLAGSHIP_SIX_KINGDOMS, 'dark', 0);
    assert.equal(variants.length, 6);
    const sigs = new Set(variants.map((v) => signature(v.buffer)));
    assert.equal(sigs.size, 6, `Building ${model.id} must recolor distinctly across all 6 kingdoms`);
    for (const v of variants) {
      assert.equal(v.inkPixels, 0, `Building ${model.id} has 0 INK`);
      assert.ok(v.k1ChangedPixels > 0, `Building ${model.id} exposes K1 pixels`);
    }
  }

  const states: readonly BuildingState[] = ['constructing', 'ready', 'damaged', 'ruins'];
  const citadel = medBronze.find((m) => m.id === 'citadel-keep')!;
  const stateSigs = new Set<string>();
  for (const st of states) {
    const res = generateBuildingSixKingdomVariants(citadel, st, [FLAGSHIP_SIX_KINGDOMS[0]], 'dark', 0)[0];
    assert.equal(res.inkPixels, 0);
    stateSigs.add(signature(res.buffer));
  }
  assert.equal(stateSigs.size, 4, 'All 4 building states must be visually distinct');
});

test('Stage 2 Universal Phenotypes: ALL 205 models produce >= 8 pixel-distinct variants & stay recognizable', () => {
  const schemas = getAllModelPhenotypeSchemas(ALL_MODELS);
  assert.equal(schemas.length, 205, 'Phenotype registry must cover all 205 models');

  for (const row of schemas) {
    assert.ok(
      row.distinctVariantCount >= 8,
      `Model ${row.modelId} generated only ${row.distinctVariantCount} distinct variants (< 8)`
    );
    assert.ok(row.allowedPatterns.length >= 2, `Model ${row.modelId} must define allowed patterns`);
    assert.ok(row.zoneScheme.length > 0, `Model ${row.modelId} must define zoneScheme`);
  }

  // Verify 5 flagship showcase species produce 12 distinct individuals each with 0 INK
  const byId = new Map(ALL_MODELS.map((m) => [m.id, m]));
  for (const spec of FIVE_SHOWCASE_SPECIES) {
    const model = byId.get(spec.modelId);
    assert.ok(model, `Showcase species ${spec.modelId} must exist in ALL_MODELS`);
    const variants = generateDistinctModelVariants(model!, 12, {
      includeSizes: true,
      withShadow: true,
    });
    assert.equal(variants.length, 12, `${spec.modelId} must produce 12 distinct individuals`);
    for (const v of variants) {
      assert.equal(v.inkPixels, 0, `${spec.modelId} variant #${v.index} must have 0 INK`);
      assert.ok(
        v.silhouetteIoU >= 0.45,
        `${spec.modelId} variant #${v.index} lost silhouette IoU (${v.silhouetteIoU})`
      );
    }
  }
});

test('Stage 2 Animal Gene Controls: coat, pattern, size, biomeTint mutate cleanly with 0 INK across showcase fauna', () => {
  const byId = new Map(ALL_MODELS.map((m) => [m.id, m]));
  const coats: readonly GeneCoat[] = ['natural', 'dark', 'albino', 'striped'];
  const patterns: readonly GenePattern[] = ['solid', 'striped', 'spotted', 'dappled'];
  const biomes: readonly GeneBiomeTint[] = ['none', 'forest', 'tundra', 'desert', 'volcanic'];

  for (const animalId of SHOWCASE_ANIMAL_IDS.slice(0, 5)) {
    const model = byId.get(animalId);
    assert.ok(model, `Showcase animal ${animalId} must exist in ALL_MODELS`);

    const coatSigs = new Set<string>();
    for (const coat of coats) {
      const v = generateAnimalPhenotypeVariant(model!, 777, {
        genes: { coat, pattern: 'solid', size: 'standard', appendages: 'ornate', biomeTint: 'none' },
        kingdomId: 0,
      });
      assert.ok(v.opaquePixels > 20, `${animalId} must render non-empty`);
      assert.equal(v.inkPixels, 0, `${animalId} (${coat}) must have 0 INK`);
      coatSigs.add(signature(v.buffer));
    }
    assert.equal(coatSigs.size, 4, `All 4 coats must be visually distinct on ${animalId}`);

    const patSigs = new Set<string>();
    for (const pattern of patterns) {
      const v = generateAnimalPhenotypeVariant(model!, 778, {
        genes: { coat: 'natural', pattern, size: 'standard', appendages: 'standard', biomeTint: 'none' },
        kingdomId: 0,
      });
      assert.equal(v.inkPixels, 0);
      patSigs.add(signature(v.buffer));
    }
    assert.equal(patSigs.size, 4, `All 4 patterns must be visually distinct on ${animalId}`);

    const biomeSigs = new Set<string>();
    for (const biomeTint of biomes) {
      const v = generateAnimalPhenotypeVariant(model!, 888, {
        genes: { coat: 'natural', pattern: 'solid', size: 'colossal', appendages: 'standard', biomeTint },
        kingdomId: 2,
      });
      assert.equal(v.inkPixels, 0);
      biomeSigs.add(signature(v.buffer));
    }
    assert.ok(biomeSigs.size >= 4, `Biome tints must mutate ${animalId}`);
  }
});

test('Stage 2 Atlas & JSON Export: packs all 6 eras & all 10 active races into 10x10 atlas without overlaps', () => {
  const bundle = packProceduralAtlasBatch({
    count: 180,
    baseSeed: 12345,
    includeAllEras: true,
    includeAllRaces: true,
  });

  assert.equal(bundle.units.length, 180);
  assert.equal(bundle.manifest.frames.length, 180);
  assert.equal(bundle.manifest.tileSize.width, 10);
  assert.equal(bundle.manifest.tileSize.height, 10);
  assert.equal(bundle.manifest.summary.eras.length, 6);
  assert.equal(bundle.manifest.summary.races.length, 10);
  assert.ok(bundle.manifest.summary.maxColorsObserved <= 8);
  assert.equal(bundle.manifest.summary.totalOrphanPixels, 0);

  const parsed = JSON.parse(bundle.jsonString) as ProceduralAtlasManifest;
  assert.equal(parsed.frames.length, 180);

  const pageOccupied = new Map<number, { x: number; y: number; w: number; h: number }[]>();
  for (const frame of parsed.frames) {
    assert.equal(frame.width, 10);
    assert.equal(frame.height, 10);
    assert.ok(frame.anchors.head.w >= 3);
    assert.ok(frame.kingdom.id >= 0 && frame.kingdom.id < 84);
    const list: { x: number; y: number; w: number; h: number }[] =
      pageOccupied.get(frame.pageIndex) ?? [];
    for (const other of list) {
      const overlaps: boolean =
        frame.x < other.x + other.w &&
        frame.x + frame.width > other.x &&
        frame.y < other.y + other.h &&
        frame.y + frame.height > other.y;
      assert.equal(overlaps, false, `Atlas frame ${frame.key} overlaps another frame`);
    }
    list.push({ x: frame.x, y: frame.y, w: frame.width, h: frame.height });
    pageOccupied.set(frame.pageIndex, list);
  }
});

test('Stage 2 Custom Races Full System: gender, age, all 11 roles, 5 power ranks & female 15% silhouette separation', () => {
  const customRaces = ACTIVE_UNIT_RACES.filter((r) => r !== 'human');
  const roleBearingRaces = customRaces.filter((r) => r !== 'hive-mind');
  const powerRanks = Object.keys(POWER_RANK_LABELS) as PowerHierarchyRank[];
  const ages: readonly UnitAge[] = ['child', 'adult', 'elder'];
  const genders: readonly UnitGender[] = ['male', 'female'];

  // 1. Every gendered custom race differs between male and female
  for (const race of roleBearingRaces) {
    const m = generateProceduralUnit({
      seed: 3333,
      era: 'medieval',
      race,
      gender: 'male',
      age: 'adult',
      role: 'peasant',
      kingdomId: 0,
      frameIndex: 0,
    });
    const f = generateProceduralUnit({
      seed: 3333,
      era: 'medieval',
      race,
      gender: 'female',
      age: 'adult',
      role: 'peasant',
      kingdomId: 0,
      frameIndex: 0,
    });
    assert.notEqual(signature(m.buffer), signature(f.buffer), `${race}: male vs female must be visually distinct`);
  }

  // 2. Every custom race (incl. hive-mind) differs between child, adult, and elder
  for (const race of customRaces) {
    const era = race === 'hive-mind' ? 'primordial' : race === 'raptor-kin' ? 'dinosaurs' : race === 'neanderthal' ? 'ice-age' : 'medieval';
    const ageSigs = new Set<string>();
    for (const age of ages) {
      const res = generateProceduralUnit({
        seed: 4100,
        era,
        race,
        gender: 'male',
        age,
        role: 'warrior',
        kingdomId: 2,
        frameIndex: 0,
      });
      ageSigs.add(signature(res.buffer));
      if (age === 'child') {
        assert.ok(
          res.audit.boundingBox.height <= 7,
          `${race} child height ${res.audit.boundingBox.height}px should be compact (<= 7px)`
        );
      } else {
        assert.ok(
          res.audit.boundingBox.height >= 8,
          `${race} ${age} height ${res.audit.boundingBox.height}px should be adult-sized (>= 8px)`
        );
      }
    }
    assert.equal(ageSigs.size, 3, `${race}: child, adult, and elder must all be distinct`);
  }

  // 3. Every role-bearing custom race reflects all 11 roles & 5 power ranks without orphans/INK
  for (const race of roleBearingRaces) {
    const era = race === 'raptor-kin' ? 'dinosaurs' : race === 'neanderthal' ? 'ice-age' : 'medieval';
    const roleSigs = new Set<string>();
    for (const role of ALL_ROLES) {
      const res = generateProceduralUnit({
        seed: 6200,
        era,
        race,
        gender: role === 'queen' ? 'female' : 'male',
        age: 'adult',
        role,
        powerRank: 'none',
        kingdomId: 3,
        frameIndex: 0,
      });
      roleSigs.add(signature(res.buffer));
      assert.equal(res.audit.inkPixels, 0, `${race}/${role} has INK`);
      assert.equal(res.audit.orphanPixels, 0, `${race}/${role} has orphans`);
      assert.ok(res.audit.uniqueColors <= 8, `${race}/${role} exceeded 8 colors`);
    }
    assert.ok(
      roleSigs.size >= 10,
      `${race} produced only ${roleSigs.size}/11 distinct role silhouettes`
    );

    const rankSigs = new Set<string>();
    for (const powerRank of powerRanks) {
      const res = generateProceduralUnit({
        seed: 6300,
        era,
        race,
        gender: 'male',
        age: 'adult',
        role: 'warrior',
        powerRank,
        kingdomId: 1,
        alliedKingdomId: 4,
        frameIndex: 0,
      });
      rankSigs.add(signature(res.buffer));
      assert.equal(res.audit.inkPixels, 0, `${race}/${powerRank} has INK`);
      assert.equal(res.audit.orphanPixels, 0, `${race}/${powerRank} has orphans`);
      assert.ok(res.audit.uniqueColors <= 8, `${race}/${powerRank} exceeded 8 colors`);
    }
    assert.equal(rankSigs.size, 5, `${race} must produce 5 distinct powerRank silhouettes`);
  }

  // 4. Exhaustive custom race audit across all genders × ages × roles × key ranks
  for (const race of customRaces) {
    const era = race === 'hive-mind' ? 'primordial' : race === 'raptor-kin' ? 'dinosaurs' : race === 'neanderthal' ? 'ice-age' : 'medieval';
    for (const gender of genders) {
      for (const age of ages) {
        for (const role of ALL_ROLES) {
          for (const powerRank of ['none', 'alliance-leader'] as const) {
            const res = generateProceduralUnit({
              seed: 7777,
              era,
              race,
              gender,
              age,
              role,
              powerRank,
              kingdomId: 0,
              alliedKingdomId: 2,
              frameIndex: 0,
            });
            assert.ok(res.audit.uniqueColors <= 8, `${race}/${gender}/${age}/${role}/${powerRank} >8 colors`);
            assert.equal(res.audit.inkPixels, 0, `${race}/${gender}/${age}/${role}/${powerRank} INK`);
            assert.equal(res.audit.orphanPixels, 0, `${race}/${gender}/${age}/${role}/${powerRank} orphan`);
            assert.equal(res.audit.semitransparentPixels, 0);
          }
        }
      }
    }
  }

  // 5. Female 10x10 monochrome silhouette mask pairwise distance >= 15%
  const femaleMasks = new Map<ActiveUnitRace, boolean[]>();
  for (const race of ACTIVE_UNIT_RACES) {
    const res = generateProceduralUnit({
      seed: 4445,
      era: 'medieval',
      race,
      gender: 'female',
      age: 'adult',
      role: 'warrior',
      kingdomId: 1,
      frameIndex: 0,
    });
    const mask: boolean[] = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        mask.push(res.buffer.getPixel(x, y) !== null);
      }
    }
    femaleMasks.set(race, mask);
  }
  for (let i = 0; i < ACTIVE_UNIT_RACES.length; i++) {
    for (let j = i + 1; j < ACTIVE_UNIT_RACES.length; j++) {
      const ra = ACTIVE_UNIT_RACES[i];
      const rb = ACTIVE_UNIT_RACES[j];
      const ma = femaleMasks.get(ra)!;
      const mb = femaleMasks.get(rb)!;
      let diff = 0;
      let union = 0;
      for (let k = 0; k < 100; k++) {
        if (ma[k] || mb[k]) union++;
        if (ma[k] !== mb[k]) diff++;
      }
      const pct = union > 0 ? (diff / union) * 100 : 0;
      assert.ok(pct >= 15, `Female pair ${ra} vs ${rb} mask diff ${pct.toFixed(1)}% (< 15%)`);
    }
  }
});

test('Stage 2 Town Hall (Ратуша): recolors distinctly across all 6 kingdoms & 4 building states with 0 INK', () => {
  const states: readonly BuildingState[] = ['constructing', 'ready', 'damaged', 'ruins'];
  const variants = generateBuildingSixKingdomVariants(
    MEDIEVAL_TOWN_HALL,
    'ready',
    FLAGSHIP_SIX_KINGDOMS,
    'dark',
    0
  );
  assert.equal(variants.length, 6);
  const sigs = new Set(variants.map((v) => signature(v.buffer)));
  assert.equal(sigs.size, 6, 'Town Hall must recolor into 6 distinct kingdom variants');
  for (const v of variants) {
    assert.equal(v.inkPixels, 0);
    assert.ok(v.k1ChangedPixels > 0);
    assert.ok(v.k2ChangedPixels > 0);
  }
  const stateSigs = new Set<string>();
  for (const st of states) {
    const v = generateBuildingSixKingdomVariants(
      MEDIEVAL_TOWN_HALL,
      st,
      [FLAGSHIP_SIX_KINGDOMS[0]],
      'dark',
      0
    )[0];
    assert.equal(v.inkPixels, 0);
    stateSigs.add(signature(v.buffer));
  }
  assert.equal(stateSigs.size, 4);
});

test('Quality Regressions: albino coats keep shadows clean (<= 6 crimson eye pixels), aquatic water remains blue, and all 24 race buildings + Town Hall meet high RTS detail density', () => {
  const byId = new Map(ALL_MODELS.map((m) => [m.id, m]));
  for (const id of ['tyrannosaurus-rex', 'mega-mammoth', 'megalodon', 'brown-bear', 'dire-wolf']) {
    const model = byId.get(id)!;
    const albino = generateAnimalPhenotypeVariant(model, 505, {
      genes: { coat: 'albino', pattern: 'solid', size: 'standard', appendages: 'standard', biomeTint: 'none' },
      kingdomId: 2,
    });
    // Count bright crimson-red pixels (#E23B3B / high R low G/B) which should only belong to tiny eye pupils (not shadows/feet)
    let crimsonPixels = 0;
    for (let y = 0; y < albino.buffer.height; y++) {
      for (let x = 0; x < albino.buffer.width; x++) {
        const hex = albino.buffer.getPixel(x, y);
        if (!hex) continue;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        if (r > 180 && g < 95 && b < 95) crimsonPixels++;
      }
    }
    assert.ok(
      crimsonPixels <= 4,
      `Albino ${id} leaked ${crimsonPixels} crimson blotch pixels into body shadows`
    );
  }

  // Aquatic megalodon under albino/striped/volcanic must keep translucent water pixels cool blue (#0A2C46/#0C3554)
  const meg = byId.get('megalodon')!;
  const megVar = generateAnimalPhenotypeVariant(meg, 77, {
    genes: { coat: 'striped', pattern: 'spotted', size: 'standard', appendages: 'ornate', biomeTint: 'volcanic' },
    kingdomId: 1,
  });
  let blueWaterPx = 0;
  let warmTranslucentPx = 0;
  for (let y = 0; y < megVar.buffer.height; y++) {
    for (let x = 0; x < megVar.buffer.width; x++) {
      const hex = megVar.buffer.getPixel(x, y);
      if (!hex || hex.length < 9) continue;
      const r = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      if (b > r + 20) blueWaterPx++;
      if (r > b + 20) warmTranslucentPx++;
    }
  }
  assert.ok(blueWaterPx >= 10, `Megalodon underwater wake should retain cool blue pixels (got ${blueWaterPx})`);
  assert.equal(warmTranslucentPx, 0, 'Megalodon translucent water must never mutate into warm stripes');

  // All 24 race buildings + MEDIEVAL_TOWN_HALL + medieval-market must have substantial pixel volume (>= 650 px)
  for (const b of [...ALL_RACE_BUILDINGS, MEDIEVAL_TOWN_HALL, byId.get('medieval-market')!]) {
    const buf = b.renderFrame(0, b.frameCount, { buildingState: 'ready' });
    let opaque = 0;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if (buf.getPixel(x, y) !== null) opaque++;
      }
    }
    assert.ok(opaque >= 650, `Structure ${b.id} (${b.width}x${b.height}) is under-detailed (${opaque} px < 650)`);
  }
});

