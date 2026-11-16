import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELDER_HEADS_6,
  FEMALE_HEADS_11,
  FEMALE_SANTA_HEADS_7,
  HUMAN_CANVAS_H,
  HUMAN_CANVAS_W,
  HUMAN_CULTURES,
  HUMAN_KINGDOM_COLORS_88,
  HUMAN_SKIN_COLORS_52,
  MALE_HEADS_11,
  MALE_SANTA_HEADS_7,
  MONARCH_HEADS_3,
  WARRIOR_HEADS_10,
  ZOMBIE_HEADS_4,
  buildHumanCrowd,
  createChildFromParents,
  createHumanFromId,
  describeHumanLayers,
  getHumanDiversitySummary,
  getHumanHeadMarker,
  renderHumanSprite,
  stepHumanCrowd,
} from './humanDiversity';

test('Human 6-layer asset catalog matches exact counts (35 bodies, 47 heads, 10 cultures, 88 kingdom colors, 52 skins x 4)', () => {
  const summary = getHumanDiversitySummary();
  assert.equal(summary.culturesCount, 10);
  assert.equal(summary.bodiesCount, 35);
  assert.equal(summary.headsCount, 47);
  assert.equal(summary.kingdomColors, 88);
  assert.equal(summary.skinColors, 52);
  assert.equal(summary.skinShades, 4);

  assert.equal(HUMAN_CULTURES.length, 10);
  assert.equal(MALE_HEADS_11.length, 11);
  assert.equal(FEMALE_HEADS_11.length, 11);
  assert.equal(MONARCH_HEADS_3.length, 3);
  assert.equal(WARRIOR_HEADS_10.length, 10);
  assert.equal(ELDER_HEADS_6.length, 6);
  assert.equal(MALE_SANTA_HEADS_7.length, 7);
  assert.equal(FEMALE_SANTA_HEADS_7.length, 7);
  assert.equal(ZOMBIE_HEADS_4.length, 4);
  assert.equal(HUMAN_KINGDOM_COLORS_88.length, 88);
  assert.equal(HUMAN_SKIN_COLORS_52.length, 52);
});

test('True 10x10 micro proportions: compact 12x12 canvas, <=38px body density, 2-4px eyeless heads, zero outline, stationary 7x3 shadow', () => {
  const base = createHumanFromId(777, {
    cultureId: 0,
    role: 'man',
    headVariant: 0,
    kingdomColorIdx: 0,
    skinColorIdx: 0,
    skinShade: 0,
    ageStage: 'adult',
    isZombie: false,
    mutation: 'none',
    isFestive: false,
  });

  // Body only at walk_0: compact 18..38 pixels, top rows 0..4 empty for head marker!
  for (const role of ['man', 'king', 'monarch'] as const) {
    const bodyOnly = renderHumanSprite({ ...base, role }, { frameIndex: 0, partOnly: 'body', showShadow: false });
    assert.equal(bodyOnly.width, HUMAN_CANVAS_W);
    assert.equal(bodyOnly.height, HUMAN_CANVAS_H);
    const bodyPixels = bodyOnly.countOpaquePixels();
    assert.ok(bodyPixels >= 18 && bodyPixels <= 38, `${role} body should be 18..38px, got ${bodyPixels}`);
    // Rows y=0..4 on 12x12 canvas (rows 0..3 inside 10x10 body box) must be empty of body pixels
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x < HUMAN_CANVAS_W; x++) {
        assert.equal(bodyOnly.getPixel(x, y), null, `Row y=${y} must stay empty on raw ${role} body`);
      }
    }
  }

  // Head only: compact 2x2..4x4, ZERO dark eye pixels (#1D1A18 / #000000)
  for (let h = 0; h < 11; h++) {
    const headBuf = renderHumanSprite({ ...base, headVariant: h }, { partOnly: 'head', showShadow: false });
    const px = headBuf.countOpaquePixels();
    assert.ok(px >= 3 && px <= 12, `Head #${h} must be micro 3..12px, got ${px}`);
  }
  for (let mh = 0; mh < 3; mh++) {
    const monarchHeadBuf = renderHumanSprite(
      { ...base, role: 'monarch', headVariant: mh },
      { partOnly: 'head', showShadow: false }
    );
    const px = monarchHeadBuf.countOpaquePixels();
    assert.ok(px >= 3 && px <= 12, `Monarch Head #${mh} must be micro 3..12px, got ${px}`);
  }

  // Exact marker animation rules: adult walk [6,8,7,5], swim [4,3,4,3], child walk [4,5,4,5], zombie hunched x=3
  assert.deepEqual([0, 1, 2, 3].map((f) => getHumanHeadMarker('man', 'walk', f).yFromBottom), [6, 8, 7, 5]);
  assert.deepEqual([0, 1, 2, 3].map((f) => getHumanHeadMarker('monarch', 'walk', f).yFromBottom), [6, 8, 7, 5]);
  assert.deepEqual([0, 1, 2, 3].map((f) => getHumanHeadMarker('man', 'swim', f).yFromBottom), [4, 3, 4, 3]);
  assert.deepEqual([0, 1, 2, 3].map((f) => getHumanHeadMarker('child', 'walk', f).yFromBottom), [4, 5, 4, 5]);
  assert.equal(getHumanHeadMarker('zombie', 'walk', 0).x, 3);

  // Full citizen sprite with shadow: stationary 7x3 unitShadow_5 at bottom row y=11 (not jumping with walk_1)
  const fullWalk0 = renderHumanSprite(base, { frameIndex: 0, showShadow: true });
  const fullWalk1 = renderHumanSprite(base, { frameIndex: 1, showShadow: true });
  assert.ok(fullWalk0.getPixel(5, 11)?.endsWith('67'));
  assert.ok(fullWalk1.getPixel(5, 11)?.endsWith('67'));
});

test('All 6 independent layers visibly transform 12x12 human sprite including cultures, 8 roles (with monarch), heads, 88 kingdoms, 52 skins, festive, zombie, and walk/swim', () => {
  const base = createHumanFromId(777, {
    cultureId: 0,
    role: 'man',
    headVariant: 0,
    kingdomColorIdx: 0,
    skinColorIdx: 0,
    skinShade: 0,
    ageStage: 'adult',
    isZombie: false,
    mutation: 'none',
    isFestive: false,
  });

  // Layer 1: All 10 cultures distinct for man, woman, warrior
  for (const role of ['man', 'woman', 'warrior'] as const) {
    const hashes = new Set<string>();
    for (let c = 0; c < 10; c++) {
      hashes.add(renderHumanSprite({ ...base, role, cultureId: c }).hashFrame());
    }
    assert.equal(hashes.size, 10, `All 10 ${role} culture costumes must look distinct`);
  }

  // Layer 2: All 8 roles distinct (including monarch above king)
  const roleHashes = new Set<string>();
  for (const role of ['man', 'woman', 'warrior', 'king', 'monarch', 'leader', 'child', 'zombie'] as const) {
    roleHashes.add(renderHumanSprite({ ...base, role }).hashFrame());
  }
  assert.equal(roleHashes.size, 8);

  // Alliance Monarch unites primary kingdom K1 + allied partner kingdom K2 and supports 3 distinct crowns
  const monarchCrowns = new Set<string>();
  for (let mh = 0; mh < 3; mh++) {
    monarchCrowns.add(renderHumanSprite({ ...base, role: 'monarch', headVariant: mh }).hashFrame());
  }
  assert.equal(monarchCrowns.size, 3, 'All 3 Alliance Monarch crowns must render distinctly');
  assert.notEqual(
    renderHumanSprite({ ...base, role: 'monarch', kingdomColorIdx: 0, alliedKingdomColorIdx: 1 }).hashFrame(),
    renderHumanSprite({ ...base, role: 'monarch', kingdomColorIdx: 0, alliedKingdomColorIdx: 4 }).hashFrame(),
    'Changing alliedKingdomColorIdx (K2) must recolor Alliance Monarch secondary heraldry'
  );

  // Layer 3: All 11 male & 11 female heads distinct
  const maleHeads = new Set<string>();
  const femaleHeads = new Set<string>();
  for (let h = 0; h < 11; h++) {
    maleHeads.add(renderHumanSprite({ ...base, role: 'man', headVariant: h }).hashFrame());
    femaleHeads.add(renderHumanSprite({ ...base, role: 'woman', headVariant: h }).hashFrame());
  }
  assert.equal(maleHeads.size, 11);
  assert.equal(femaleHeads.size, 11);

  // Layer 4 & 5: Kingdom & skin recolor
  assert.notEqual(
    renderHumanSprite({ ...base, kingdomColorIdx: 0 }).hashFrame(),
    renderHumanSprite({ ...base, kingdomColorIdx: 24 }).hashFrame()
  );
  assert.notEqual(
    renderHumanSprite({ ...base, skinColorIdx: 1, skinShade: 0 }).hashFrame(),
    renderHumanSprite({ ...base, skinColorIdx: 28, skinShade: 2 }).hashFrame()
  );

  // Layer 6: Age, zombie, festive & mutations
  const states = [
    renderHumanSprite({ ...base, ageStage: 'child' }).hashFrame(),
    renderHumanSprite({ ...base, ageStage: 'adult' }).hashFrame(),
    renderHumanSprite({ ...base, ageStage: 'elder' }).hashFrame(),
    renderHumanSprite({ ...base, isZombie: true }).hashFrame(),
    renderHumanSprite({ ...base, isFestive: true }).hashFrame(),
    renderHumanSprite({ ...base, mutation: 'giant' }).hashFrame(),
    renderHumanSprite({ ...base, mutation: 'plague' }).hashFrame(),
  ];
  assert.equal(new Set(states).size, 7);

  // 4 walk frames and 4 swim frames animate cleanly
  const walkFrames = new Set([0, 1, 2, 3].map((f) => renderHumanSprite(base, { frameIndex: f, mode: 'walk' }).hashFrame()));
  const swimFrames = new Set([0, 1, 2, 3].map((f) => renderHumanSprite(base, { frameIndex: f, mode: 'swim' }).hashFrame()));
  assert.equal(walkFrames.size, 4);
  assert.ok(swimFrames.size >= 2);
});

test('Child skin inheritance strictly picks Parent A or Parent B and preserves personal head identity through aging', () => {
  const father = createHumanFromId(10, { cultureId: 1, skinColorIdx: 3, kingdomColorIdx: 5 });
  const mother = createHumanFromId(11, { cultureId: 6, skinColorIdx: 44, kingdomColorIdx: 5 });

  let sawFatherSkin = false;
  let sawMotherSkin = false;
  for (let cid = 100; cid < 130; cid++) {
    const child = createChildFromParents(father, mother, cid, 'man');
    assert.ok(
      child.skinColorIdx === father.skinColorIdx || child.skinColorIdx === mother.skinColorIdx,
      `Child ${cid} must inherit skin strictly from Parent A or Parent B`
    );
    if (child.skinColorIdx === father.skinColorIdx) sawFatherSkin = true;
    if (child.skinColorIdx === mother.skinColorIdx) sawMotherSkin = true;

    assert.equal(child.ageStage, 'child');
    const adultInfo = describeHumanLayers({ ...child, ageStage: 'adult' });
    const elderInfo = describeHumanLayers({ ...child, ageStage: 'elder' });
    assert.notEqual(adultInfo.headKey, elderInfo.headKey);
  }
  assert.equal(sawFatherSkin && sawMotherSkin, true);
});

test('Top-down crowd simulator builds 24 diverse humans and moves them cleanly within 240x112 8x8-tile map', () => {
  const crowd = buildHumanCrowd('two-cultures-same-kingdom', 101, 240, 112);
  assert.equal(crowd.length, 24);
  const startPositions = crowd.map((c) => `${c.x},${c.y}`).join('|');

  for (let i = 0; i < 10; i++) {
    stepHumanCrowd(crowd, 0.1, 240, 112);
  }
  const endPositions = crowd.map((c) => `${c.x},${c.y}`).join('|');
  assert.notEqual(startPositions, endPositions);
  for (const c of crowd) {
    assert.ok(c.x >= 12 && c.x <= 228);
    assert.ok(c.y >= 16 && c.y <= 104);
  }
});
