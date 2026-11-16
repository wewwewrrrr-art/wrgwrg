import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIEVAL_ROLE_LABELS,
  MedievalHumanRole,
  PAPER_DOLL_LAYERS,
  POWER_RANK_LABELS,
  PowerHierarchyRank,
  UNIT_STATUS_LABELS,
  UnitAge,
  UnitGender,
  UnitStatus,
  benchmarkProceduralUnitsToAtlas,
  generateMedievalCrowdGrid,
  generateMedievalHuman,
} from './proceduralHuman';
import {
  HAIR_PALETTES_12,
  KINGDOM_PALETTES_84,
  SKIN_PALETTES_14,
  computeMinKingdomDeltaE,
} from './proceduralPalettes';

test('Palettes: 84 kingdom colors satisfy CIELAB min perceptual distance >= 12, plus 14 skins and 12 hairs (each 4-tone)', () => {
  assert.equal(KINGDOM_PALETTES_84.length, 84);
  assert.equal(SKIN_PALETTES_14.length, 14);
  assert.equal(HAIR_PALETTES_12.length, 12);

  for (const k of KINGDOM_PALETTES_84) {
    assert.equal(k.k1Ramp.length, 4);
    assert.equal(k.k2Ramp.length, 4);
  }
  for (const s of SKIN_PALETTES_14) {
    assert.equal(s.ramp.length, 4);
  }
  for (const h of HAIR_PALETTES_12) {
    assert.equal(h.ramp.length, 4);
  }
  assert.ok(HAIR_PALETTES_12.some((h) => h.isGrey), 'Hair palettes must include grey/silver (седина)');

  const minDeltaE = computeMinKingdomDeltaE(KINGDOM_PALETTES_84);
  assert.ok(
    minDeltaE >= 12,
    `All 84 kingdom colors must be perceptually separable in CIELAB (expected min ΔE >= 12, got ${minDeltaE.toFixed(2)})`
  );
});

test('Paper-doll pipeline: exact 9-layer order, determinism from seed, and child 6-7px vs adult 9-10px scale', () => {
  assert.deepEqual(PAPER_DOLL_LAYERS, [
    'body',
    'skin',
    'faceEyes',
    'hairBeard',
    'clothing',
    'armor',
    'headgear',
    'weaponTool',
    'statusSign',
  ]);

  const a = generateMedievalHuman({ seed: 424242, era: 'medieval' });
  const b = generateMedievalHuman({ seed: 424242, era: 'medieval' });
  assert.equal(a.buffer.hashFrame(), b.buffer.hashFrame());
  assert.deepEqual(a.profile, b.profile);
  assert.deepEqual(a.layerTrace, PAPER_DOLL_LAYERS);

  // Child strictly 6-7 px tall; adult 9-10 px tall
  const childMale = generateMedievalHuman({
    seed: 101,
    age: 'child',
    gender: 'male',
    role: 'peasant',
  });
  const childFemale = generateMedievalHuman({
    seed: 102,
    age: 'child',
    gender: 'female',
    role: 'peasant',
  });
  assert.ok(
    childMale.audit.boundingBox.height >= 6 && childMale.audit.boundingBox.height <= 7,
    `Child male height must be 6-7px, got ${childMale.audit.boundingBox.height}`
  );
  assert.ok(
    childFemale.audit.boundingBox.height >= 6 && childFemale.audit.boundingBox.height <= 7,
    `Child female height must be 6-7px, got ${childFemale.audit.boundingBox.height}`
  );

  const adult = generateMedievalHuman({
    seed: 101,
    age: 'adult',
    gender: 'male',
    role: 'king',
  });
  assert.ok(
    adult.audit.boundingBox.height >= 9 && adult.audit.boundingBox.height <= 10,
    `Adult height must be 9-10px, got ${adult.audit.boundingBox.height}`
  );
  assert.ok(childMale.audit.boundingBox.height < adult.audit.boundingBox.height);
});

test('Power hierarchy & all 11 medieval roles produce distinct silhouettes (not just color swaps)', () => {
  const roles = Object.keys(MEDIEVAL_ROLE_LABELS) as MedievalHumanRole[];
  const silhouetteSignatures = new Set<string>();

  for (const role of roles) {
    const res = generateMedievalHuman({
      seed: 777,
      age: 'adult',
      gender: role === 'queen' ? 'female' : 'male',
      role,
      kingdomId: 0,
      skinId: 2,
      hairId: 1,
      status: 'healthy',
    });
    // Binary silhouette mask (x,y occupied) proves shape differs, not merely pigment
    let mask = '';
    for (let y = 0; y < res.buffer.height; y++) {
      for (let x = 0; x < res.buffer.width; x++) {
        mask += res.buffer.getPixel(x, y) ? '1' : '0';
      }
    }
    silhouetteSignatures.add(mask);
  }
  assert.equal(
    silhouetteSignatures.size,
    roles.length,
    'Every medieval role must have a unique pixel silhouette'
  );

  // Power ranks on same base citizen must also differentiate silhouettes
  const ranks = Object.keys(POWER_RANK_LABELS) as PowerHierarchyRank[];
  const rankHashes = new Set<string>();
  for (const powerRank of ranks) {
    const res = generateMedievalHuman({
      seed: 900,
      age: 'adult',
      gender: 'male',
      role: 'warrior',
      powerRank,
      kingdomId: 0,
      alliedKingdomId: 1,
      skinId: 2,
      hairId: 1,
      status: 'healthy',
    });
    rankHashes.add(res.buffer.hashFrame());
  }
  assert.equal(rankHashes.size, ranks.length, 'Every power hierarchy rank must visually differ');
});

test('Zone-based recoloring modifies tagged K1/K2/skin/hair zones while leaving non-kingdom pixels intact', () => {
  const kRed = generateMedievalHuman({
    seed: 555,
    age: 'adult',
    gender: 'male',
    role: 'warrior',
    kingdomId: 0,
    skinId: 1,
    hairId: 2,
    status: 'healthy',
  });
  const kBlue = generateMedievalHuman({
    seed: 555,
    age: 'adult',
    gender: 'male',
    role: 'warrior',
    kingdomId: 1,
    skinId: 1,
    hairId: 2,
    status: 'healthy',
  });

  assert.ok(kRed.audit.k1ZonePixels >= 4, 'Sprite must mark explicit K1 kingdom zone pixels');
  assert.ok(kRed.audit.skinZonePixels >= 4, 'Sprite must mark explicit skin zone pixels');
  assert.notEqual(kRed.buffer.hashFrame(), kBlue.buffer.hashFrame());

  // Non-kingdom/skin/hair pixels (e.g. steel sword/armor) must remain identical across kingdoms
  let steelChanged = 0;
  let kingdomChanged = 0;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const z = kRed.zoneMap[y * 10 + x];
      const c1 = kRed.buffer.getPixel(x, y);
      const c2 = kBlue.buffer.getPixel(x, y);
      if ((z === 'k1' || z === 'k2') && c1 !== c2) kingdomChanged++;
      if (z === 'metal' && c1 !== c2) steelChanged++;
    }
  }
  assert.ok(kingdomChanged > 0, 'K1/K2 zone pixels must recolor');
  assert.equal(steelChanged, 0, 'Steel armor/weapon pixels outside kingdom zones must not recolor');
});

test('Strict sprite audit across all roles, ages, genders, power ranks & statuses: <= 8 colors, 0 semitransparent, 0 INK, 0 orphan specks', () => {
  const roles = Object.keys(MEDIEVAL_ROLE_LABELS) as MedievalHumanRole[];
  const statuses = Object.keys(UNIT_STATUS_LABELS) as UnitStatus[];
  const ages: UnitAge[] = ['child', 'adult', 'elder'];
  const genders: UnitGender[] = ['male', 'female'];
  const ranks = Object.keys(POWER_RANK_LABELS) as PowerHierarchyRank[];

  let checked = 0;
  for (const role of roles) {
    for (const age of ages) {
      for (const gender of genders) {
        for (const status of statuses) {
          for (const powerRank of ranks) {
            const res = generateMedievalHuman({
              seed: 1000 + checked,
              role,
              age,
              gender,
              status,
              powerRank,
              kingdomId: checked % 84,
              alliedKingdomId: (checked + 11) % 84,
              skinId: checked % 14,
              hairId: checked % 12,
              frameIndex: checked % 4,
            });
            checked++;
            assert.ok(
              res.audit.uniqueColors <= 8,
              `Sprite (${role}/${age}/${gender}/${status}/${powerRank}) exceeded 8 colors: ${res.audit.uniqueColors}`
            );
            assert.equal(
              res.audit.semitransparentPixels,
              0,
              `Sprite (${role}/${age}/${status}) must have 0 semi-transparent pixels`
            );
            assert.equal(
              res.audit.inkPixels,
              0,
              `Sprite (${role}/${age}/${status}) must have 0 black #131110 INK pixels`
            );
            assert.equal(
              res.audit.orphanPixels,
              0,
              `Sprite (${role}/${age}/${gender}/${status}/${powerRank}) had ${res.audit.orphanPixels} isolated 1px orphan speck(s)`
            );
          }
        }
      }
    }
  }
  assert.ok(checked >= 1900);

  // Also verify 10x10 crowd grid (100 random medieval units)
  const grid = generateMedievalCrowdGrid(2026, 100);
  assert.equal(grid.length, 100);
  for (const unit of grid) {
    assert.ok(unit.audit.uniqueColors <= 8);
    assert.equal(unit.audit.semitransparentPixels, 0);
    assert.equal(unit.audit.orphanPixels, 0);
  }
});

test('Performance benchmark: generates 10,000 unique procedural medieval units into BakedSpriteAtlas cleanly', () => {
  const bench = benchmarkProceduralUnitsToAtlas(10000);
  assert.equal(bench.generatedCount, 10000);
  assert.equal(bench.bakedFrames, 10000);
  assert.ok(bench.maxColorsObserved <= 8, `Max colors observed: ${bench.maxColorsObserved}`);
  assert.ok(bench.pagesUsed <= 3, `Expected compact packing <= 3 atlas pages, got ${bench.pagesUsed}`);
  assert.ok(
    bench.elapsedMs < 2000,
    `10,000 procedural units benchmark took ${bench.elapsedMs}ms (limit 2000ms)`
  );
  console.log(
    `[Benchmark] 10,000 unique medieval 10×10 units generated & baked into ${bench.pagesUsed} atlas page(s) in ${bench.elapsedMs} ms (maxColors=${bench.maxColorsObserved})`
  );
});
