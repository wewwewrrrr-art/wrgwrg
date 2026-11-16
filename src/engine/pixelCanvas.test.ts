import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_MODELS,
  BUILDING_STATE_OPTIONS,
  ENTITY_TYPE_TABS,
  ERA_TABS,
  filterModels,
  getEraTypeSummaryMatrix,
  getModelBuildingFunction,
  getModelEntityType,
  getModelEra,
  renderModelWithContext,
} from '../models';
import { AQUATIC_MODELS } from '../models/aquaticCreatures';
import { BIOME_CREATURE_MODELS } from '../models/biomeCreatures';
import { ERA_BRONZE_UNITS } from '../models/eraBronzeUnits';
import { ERA_DINOSAUR_MODELS } from '../models/eraDinosaurs';
import { ERA_MEDIEVAL_UNITS } from '../models/eraMedievalUnits';
import { ERA_MEGAFAUNA_MODELS } from '../models/eraMegafauna';
import { ERA_PRIMORDIAL_MODELS } from '../models/eraPrimordial';
import { ERA_PROP_MODELS } from '../models/eraProps';
import { ERA_STONE_AGE_MODELS } from '../models/eraStoneAge';
import { ERA_STRUCTURE_MODELS } from '../models/eraStructures';
import { WILDLIFE_CREATURE_MODELS } from '../models/wildlifeCreatures';
import {
  BIOMES,
  BIOME_HEIGHT,
  BIOME_WIDTH,
  hitTestBiomeEntities,
  isBiomeWaterPixel,
  renderBiomeBackdrop,
  stepBiomePlacement,
} from '../models/biomes';
import { generateModelJson, generateStandaloneModelTs } from '../utils/exportModelCode';
import {
  INK,
  RAMPS,
  SHADOW_COLOR,
  WATER_LINE,
  buildMaskColorLookup,
  calculateKingdomRamp,
  calculateSkinShades,
  hexToRgba,
} from './palette';
import { PixelBuffer } from './pixelCanvas';
import {
  applyEarthquakeAt,
  createBiomeSimState,
  removeBiomeEntityById,
  renderBiomeSimBackdrop,
  spawnBiomeModelAt,
  stepBiomeSim,
} from './biomeSimulation';
import { STAGE_SHADOW_THEMES, generateShapeBasedSoftShadow, isSoftShadowPixel } from './softShadow';
import { buildPixelSandboxCastShadow, toPixelSandboxSprite } from './pixelSandboxStyle';
import { BakedSpriteAtlas, runAtlasInstancingBenchmark } from './spriteAtlas';

test('PixelBuffer.layer() isolates sub-assemblies with darkened material seams and zero INK black outlines', () => {
  const buf = new PixelBuffer(20, 20);
  buf.layer((sub) => sub.fillRect(3, 3, 14, 14, RAMPS.marble.mid));
  buf.layer((sub) => sub.fillRect(7, 7, 6, 6, RAMPS.magenta.mid));

  // No #131110 black contour stamped on outside or inside
  let inkCount = 0;
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (buf.getPixel(x, y) === INK.toUpperCase()) inkCount++;
    }
  }
  assert.equal(inkCount, 0);
  // Underlying parent marble pixel at (6, 7) adjacent to magenta layer gets shaded darker than mid marble
  assert.notEqual(buf.getPixel(6, 7), RAMPS.marble.mid);
  assert.notEqual(buf.getPixel(6, 7), null);
  assert.equal(buf.getPixel(7, 7), RAMPS.magenta.mid);
});

test('Kingdom Lerp & Skin Phenotype math produce deterministic ramps', () => {
  // Dark color boost rule: if all RGB < 128, add +50 to each before Lerp
  const blackRamp = calculateKingdomRamp('#262626');
  // 0x26 = 38; 38 + 50 = 88 -> #585858
  assert.equal(blackRamp[0], '#585858');
  assert.notEqual(blackRamp[1], blackRamp[0]);
  assert.notEqual(blackRamp[3], blackRamp[2]);

  // Skin phenotype blend & [1, 0.9, 0.8, 0.7] shade darkening
  const lightSkin = calculateSkinShades('#F5D6BA', '#F3C6BE', 0);
  assert.equal(lightSkin[0], '#F5D6BA');
  // 245 * 0.7 = 171.5 -> 172 (AC), 214 * 0.7 = 150 (96), 186 * 0.7 = 130 (82)
  assert.equal(lightSkin[3], '#AC9682');
});

test('Dynamic mask recoloring & zombie transform preserve dimensions and alter mask pixels', () => {
  const knight = ALL_MODELS.find((m) => m.id === 'paladin-knight');
  assert.ok(knight);

  const raw = renderModelWithContext(knight, 0, { kingdomId: 'original', phenotypeId: 'skin_light' });
  const red = renderModelWithContext(knight, 0, { kingdomId: 'red', phenotypeId: 'skin_dark' });
  const zombie = renderModelWithContext(knight, 0, {
    kingdomId: 'blue',
    phenotypeId: 'skin_light',
    unitAction: 'zombie',
  });

  assert.notEqual(raw.hashFrame(), red.hashFrame());
  assert.notEqual(red.hashFrame(), zombie.hashFrame());

  // Original raw buffer must still retain K1/SKIN mask pixels cleanly
  const stats = knight.renderFrame(0, knight.frameCount).countPixelStats();
  assert.ok(stats.k1Pixels > 0, 'Knight raw frame must contain K1_MASK pixels');
  assert.ok(stats.skinPixels > 0, 'Knight raw frame must contain SKIN_MASK pixels');

  // Lookup map must replace K1_MASK exactly
  const lookup = buildMaskColorLookup('red', 'skin_dark');
  assert.ok(lookup.has(RAMPS.magenta.highlight.toUpperCase()));
});

test('filterModels partitions all 7 collections, 9 eras, and 4 entity types across tiers (205 total)', () => {
  assert.equal(ALL_MODELS.length, 205);
  assert.equal(filterModels(ALL_MODELS, 'aquatic').length, 13);
  assert.equal(filterModels(ALL_MODELS, 'nature').length, 20);
  assert.equal(filterModels(ALL_MODELS, 'substance').length, 17);
  assert.equal(filterModels(ALL_MODELS, 'weather').length, 13);
  assert.equal(filterModels(ALL_MODELS, 'static').length, 22);
  assert.equal(filterModels(ALL_MODELS, 'animated').length, 34);
  assert.equal(filterModels(ALL_MODELS, 'unit').length, 86);

  const t1 = filterModels(ALL_MODELS, 'all', 'I');
  const t2 = filterModels(ALL_MODELS, 'all', 'II');
  const t3 = filterModels(ALL_MODELS, 'all', 'III');
  assert.ok(t1.length >= 50, 'Expected at least 50 Tier I models');
  assert.ok(t2.length >= 55, 'Expected at least 55 Tier II models');
  assert.ok(t3.length >= 40, 'Expected at least 40 Tier III models');
  assert.equal(t1.length + t2.length + t3.length, 205);

  // Verify every era tab matches models and sums cleanly to 205
  const specificEras = ERA_TABS.filter((e) => e.id !== 'all');
  assert.equal(specificEras.length, 9);
  let eraSum = 0;
  for (const era of specificEras) {
    const inEra = filterModels(ALL_MODELS, 'all', 'all', era.id);
    assert.ok(inEra.length >= 6, `Era ${era.id} must have >= 6 models (got ${inEra.length})`);
    for (const m of inEra) {
      assert.equal(getModelEra(m), era.id);
    }
    eraSum += inEra.length;
  }
  assert.equal(eraSum, 205);

  // Verify orthogonal EntityType filter sums cleanly to 205
  const specificTypes = ENTITY_TYPE_TABS.filter((t) => t.id !== 'all');
  assert.equal(specificTypes.length, 4);
  let typeSum = 0;
  for (const t of specificTypes) {
    const matching = filterModels(ALL_MODELS, 'all', 'all', 'all', t.id);
    assert.ok(matching.length >= 25);
    typeSum += matching.length;
  }
  assert.equal(typeSum, 205);
});

test('All 56 structures render borderless (zero INK black contours) and meet >= 500px architectural density', () => {
  const structures = ALL_MODELS.filter((m) => m.kind === 'static' || m.kind === 'animated');
  assert.equal(structures.length, 56);

  const countInk = (buf: PixelBuffer): number => {
    let n = 0;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if (buf.getPixel(x, y) === INK.toUpperCase()) n++;
      }
    }
    return n;
  };

  for (const model of structures) {
    const frame0 = model.renderFrame(0, model.frameCount);
    assert.equal(frame0.width, model.width);
    assert.equal(frame0.height, model.height);
    assert.equal(
      countInk(frame0),
      0,
      `Structure ${model.id} must have zero black INK outline pixels`
    );
    assert.ok(
      frame0.countOpaquePixels() >= 500,
      `Structure ${model.id} expected >= 500 opaque pixels, got ${frame0.countOpaquePixels()}`
    );

    if (model.kind === 'static') {
      assert.equal(model.frameCount, 1);
    } else {
      assert.ok(model.frameCount >= 12);
      const hashes = new Set<string>();
      for (let f = 0; f < model.frameCount; f++) {
        const buf = model.renderFrame(f, model.frameCount);
        assert.equal(
          countInk(buf),
          0,
          `Animated structure ${model.id} frame ${f} must have zero INK outlines`
        );
        hashes.add(buf.hashFrame());
      }
      assert.ok(hashes.size >= 6, `Animated structure ${model.id} must have >= 6 distinct frames`);
    }
  }
});

test('All 20 nature & 17 substance models satisfy borderless rules and animation density', () => {
  const envModels = ALL_MODELS.filter((m) => m.kind === 'nature' || m.kind === 'substance');
  assert.equal(envModels.length, 37);

  const countInk = (buf: PixelBuffer): number => {
    let n = 0;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if (buf.getPixel(x, y) === INK.toUpperCase()) n++;
      }
    }
    return n;
  };

  for (const model of envModels) {
    const frame0 = model.renderFrame(0, model.frameCount);
    assert.equal(frame0.width, model.width);
    assert.equal(frame0.height, model.height);
    assert.ok(
      frame0.countOpaquePixels() >= 220,
      `Model ${model.id} expected >= 220 opaque pixels, got ${frame0.countOpaquePixels()}`
    );
    assert.equal(
      countInk(frame0),
      0,
      `Model ${model.id} must have zero INK black outline pixels`
    );

    if (model.frameCount > 1) {
      const hashes = new Set<string>();
      for (let f = 0; f < model.frameCount; f++) {
        const buf = model.renderFrame(f, model.frameCount);
        assert.equal(
          countInk(buf),
          0,
          `Animated model ${model.id} frame ${f} must have zero INK outline pixels`
        );
        hashes.add(buf.hashFrame());
      }
      assert.ok(hashes.size >= 6, `Animated model ${model.id} must have >= 6 distinct frames`);
    }
  }
});

test('All 13 weather & atmospheric VFX models animate cleanly with alpha particles and no ground shadow', () => {
  const weatherModels = filterModels(ALL_MODELS, 'weather');
  assert.equal(weatherModels.length, 13);

  for (const model of weatherModels) {
    assert.equal(model.supportsShadow, false, `${model.id} must declare supportsShadow: false`);
    assert.equal(model.noOutlineRequired, true, `${model.id} must declare noOutlineRequired: true`);
    assert.ok(model.frameCount >= 12, `${model.id} expected >= 12 animation frames`);

    const hashes = new Set<string>();
    let maxSemiAlpha = 0;
    for (let f = 0; f < model.frameCount; f++) {
      const buf = model.renderFrame(f, model.frameCount);
      assert.equal(buf.width, model.width);
      assert.equal(buf.height, model.height);
      const stats = buf.countPixelStats();
      assert.ok(stats.opaquePixels >= 150, `Weather ${model.id} frame ${f} must have visible structure`);
      if (stats.semitransparentPixels > maxSemiAlpha) {
        maxSemiAlpha = stats.semitransparentPixels;
      }
      hashes.add(buf.hashFrame());
    }
    assert.ok(hashes.size >= 8, `Weather ${model.id} must animate across >= 8 unique frames`);
    assert.ok(maxSemiAlpha > 0, `Weather ${model.id} must include semi-transparent atmospheric pixels`);
  }
});

test('All 13 aquatic monsters swim in WATER_LINE, execute unique multi-phase attacks, and support K1/K2 + hit/death/zombie', () => {
  const aquatic = filterModels(ALL_MODELS, 'aquatic');
  assert.equal(aquatic.length, 13);

  for (const creature of aquatic) {
    assert.equal(creature.supportsShadow, false, `${creature.id} must declare supportsShadow: false`);
    assert.equal(creature.noOutlineRequired, true, `${creature.id} must declare noOutlineRequired: true`);
    assert.ok(
      creature.attackName && creature.attackName.trim().length > 4,
      `${creature.id} must declare a descriptive attackName`
    );
    assert.ok(creature.frameCount >= 12, `${creature.id} must animate across >= 12 frames`);

    const swimHashes = new Set<string>();
    const attackHashes = new Set<string>();
    let diffFrames = 0;
    let hasWaterline = false;

    for (let f = 0; f < creature.frameCount; f++) {
      const swimBuf = creature.renderFrame(f, creature.frameCount, { unitAction: 'normal' });
      const atkBuf = creature.renderFrame(f, creature.frameCount, { unitAction: 'attack' });

      assert.equal(swimBuf.width, creature.width);
      assert.equal(swimBuf.height, creature.height);
      assert.ok(
        swimBuf.countOpaquePixels() >= 180,
        `${creature.id} swim frame ${f} expected >= 180 opaque pixels, got ${swimBuf.countOpaquePixels()}`
      );
      assert.ok(
        atkBuf.countOpaquePixels() >= 180,
        `${creature.id} attack frame ${f} expected >= 180 opaque pixels, got ${atkBuf.countOpaquePixels()}`
      );

      const sHash = swimBuf.hashFrame();
      const aHash = atkBuf.hashFrame();
      swimHashes.add(sHash);
      attackHashes.add(aHash);
      if (sHash !== aHash) diffFrames++;

      if (f === 0) {
        for (let y = 0; y < swimBuf.height; y++) {
          for (let x = 0; x < swimBuf.width; x++) {
            const px = swimBuf.getPixel(x, y);
            if (px === WATER_LINE.light || px === WATER_LINE.mid) hasWaterline = true;
          }
        }
      }
    }

    assert.equal(hasWaterline, true, `${creature.id} must render animated WATER_LINE surface`);
    assert.ok(swimHashes.size >= 8, `${creature.id} swim cycle must have >= 8 unique frames`);
    assert.ok(attackHashes.size >= 8, `${creature.id} attack cycle must have >= 8 unique frames`);
    assert.ok(
      diffFrames >= 8,
      `${creature.id} attack animation must differ visibly from swim across >= 8 frames (got ${diffFrames})`
    );

    // Kingdom mask recoloring
    const orig = renderModelWithContext(creature, 0, { kingdomId: 'original' });
    const blue = renderModelWithContext(creature, 0, { kingdomId: 'blue' });
    assert.notEqual(orig.hashFrame(), blue.hashFrame(), `${creature.id} must recolor K1/K2 accents`);

    // Combat actions hit/death/zombie must transform sprite cleanly
    const hit = renderModelWithContext(creature, 3, { unitAction: 'hit' });
    const death = renderModelWithContext(creature, 6, { unitAction: 'death' });
    const zombie = renderModelWithContext(creature, 0, { unitAction: 'zombie' });
    assert.notEqual(orig.hashFrame(), hit.hashFrame(), `${creature.id} hit action must mutate pixels`);
    assert.notEqual(orig.hashFrame(), death.hashFrame(), `${creature.id} death action must mutate pixels`);
    assert.notEqual(orig.hashFrame(), zombie.hashFrame(), `${creature.id} zombie action must mutate pixels`);
  }
});

test('All 86 units & creatures satisfy animation, anchor, shadow, waterline, and recolor invariants', () => {
  const units = filterModels(ALL_MODELS, 'unit');
  assert.equal(units.length, 86);

  for (const unit of units) {
    const hashes = new Set<string>();
    for (let f = 0; f < unit.frameCount; f++) {
      const frame = unit.renderFrame(f, unit.frameCount, { unitMode: 'walk', unitAction: 'normal' });
      assert.equal(frame.width, unit.width);
      assert.equal(frame.height, unit.height);
      assert.ok(frame.countOpaquePixels() >= 25, `Unit ${unit.id} must have visible body`);
      hashes.add(frame.hashFrame());
    }
    assert.ok(hashes.size >= 4, `Unit ${unit.id} must animate across >= 4 unique frames`);

    if (unit.unitMeta?.supportsSwim) {
      const swimFrame = unit.renderFrame(0, unit.frameCount, { unitMode: 'swim' });
      let hasWater = false;
      for (let y = 0; y < swimFrame.height; y++) {
        for (let x = 0; x < swimFrame.width; x++) {
          const p = swimFrame.getPixel(x, y);
          if (p === WATER_LINE.light || p === WATER_LINE.mid) hasWater = true;
        }
      }
      assert.equal(hasWater, true, `Unit ${unit.id} swim frame must render #D1E3EB/#D5E2EA waterline`);
    }

    if (unit.getAnchors) {
      const anchors = unit.getAnchors(0, unit.frameCount, { unitMode: 'walk' });
      assert.ok(anchors, `Unit ${unit.id} must expose head/item/pivot anchors`);
      const rendered = renderModelWithContext(unit, 0, {
        unitMode: 'walk',
        showShadow: true,
        stageBg: 'meadow',
      });
      // Soft shadow must ground under pivot row without any legacy flat #11102B66 pixel
      let foundSoftNearPivot = false;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = 0; dy <= 2; dy++) {
          const px = rendered.getPixel(anchors.pivot.x + dx, anchors.pivot.y + dy);
          if (px && isSoftShadowPixel(px)) foundSoftNearPivot = true;
        }
      }
      assert.equal(
        foundSoftNearPivot,
        true,
        `Unit ${unit.id} must synthesize soft ground shadow beneath pivot`
      );
    }

    // Verify Kingdom recolor actually transforms frame pixels
    const maskFrame = renderModelWithContext(unit, 0, { kingdomId: 'original' });
    const blueFrame = renderModelWithContext(unit, 0, { kingdomId: 'blue' });
    assert.notEqual(
      maskFrame.hashFrame(),
      blueFrame.hashFrame(),
      `Unit ${unit.id} must respond to K1/K2 kingdom recoloring`
    );
  }
});

test('Shape-based soft shadows eliminate #11102B66 blobs, adapt to stageBg, and never overwrite foreground pixels', () => {
  const legacyShadow = SHADOW_COLOR.toUpperCase();

  for (const model of ALL_MODELS) {
    const noShadow = renderModelWithContext(model, 0, {
      kingdomId: 'original',
      showShadow: false,
    });
    const withDarkShadow = renderModelWithContext(model, 0, {
      kingdomId: 'original',
      showShadow: true,
      stageBg: 'dark',
    });

    for (let y = 0; y < model.height; y++) {
      for (let x = 0; x < model.width; x++) {
        assert.notEqual(
          noShadow.getPixel(x, y),
          legacyShadow,
          `Model ${model.id} must never contain flat #11102B66 when showShadow=false`
        );
        assert.notEqual(
          withDarkShadow.getPixel(x, y),
          legacyShadow,
          `Model ${model.id} must never emit flat #11102B66 black blobs when showShadow=true`
        );
      }
    }

    if (model.supportsShadow === false) {
      assert.equal(
        withDarkShadow.hashFrame(),
        noShadow.hashFrame(),
        `Shadow-exempt model ${model.id} must render identically regardless of showShadow`
      );
    }
  }

  // Verify soft multi-stop alpha penumbra and stageBg color adaptation
  const stages = ['dark', 'meadow', 'parchment', 'checker', 'ocean'] as const;
  const checkIds = [
    'slime-cube',
    'dire-wolf',
    'forest-treant',
    'elder-dragon',
    'distortus-rex',
    'tyrannosaurus-rex',
    'gustave-crocodile',
    'siege-catapult',
    'sakura-tree',
    'bismuth-hopper-crystal',
    'bone-ossuary',
  ];

  for (const id of checkIds) {
    const model = ALL_MODELS.find((m) => m.id === id);
    assert.ok(model);
    const withoutShadow = renderModelWithContext(model, 0, { showShadow: false });
    const stageHashes = new Set<string>();

    for (const stageBg of stages) {
      const withShadow = renderModelWithContext(model, 0, { showShadow: true, stageBg });
      stageHashes.add(withShadow.hashFrame());

      const theme = STAGE_SHADOW_THEMES[stageBg];
      const shadowAlphas = new Set<number>();

      for (let y = 0; y < model.height; y++) {
        for (let x = 0; x < model.width; x++) {
          const fg = withoutShadow.getPixel(x, y);
          const outPx = withShadow.getPixel(x, y);
          if (fg !== null) {
            assert.equal(
              outPx,
              fg,
              `Soft shadow on ${id} (${stageBg}) at (${x},${y}) must sit behind sprite and never overwrite foreground`
            );
          } else if (outPx !== null) {
            const [r, g, b, a] = hexToRgba(outPx);
            assert.equal(r, theme.r, `${id} shadow R must match ${stageBg} theme`);
            assert.equal(g, theme.g, `${id} shadow G must match ${stageBg} theme`);
            assert.equal(b, theme.b, `${id} shadow B must match ${stageBg} theme`);
            assert.ok(a > 0 && a <= Math.round(theme.maxAlpha * 255) + 1);
            shadowAlphas.add(a);
          }
        }
      }

      assert.ok(
        shadowAlphas.size >= 3,
        `Soft shadow on ${id} (${stageBg}) must feather across >= 3 alpha stops (got ${shadowAlphas.size})`
      );
    }

    assert.equal(
      stageHashes.size,
      stages.length,
      `${id} must produce distinct stage-calibrated shadow palettes across all 5 stageBg modes`
    );
  }

  // Verify shadow geometry follows actual silhouette shape (narrow spire vs wide horizontal bar)
  const narrowTower = new PixelBuffer(40, 40);
  narrowTower.fillRect(18, 8, 4, 28, '#C8C8C8');
  const wideWall = new PixelBuffer(40, 40);
  wideWall.fillRect(6, 30, 28, 6, '#C8C8C8');
  const narrowShadow = generateShapeBasedSoftShadow(narrowTower, { stageBg: 'parchment' });
  const wideShadow = generateShapeBasedSoftShadow(wideWall, { stageBg: 'parchment' });
  assert.notEqual(narrowShadow.hashFrame(), wideShadow.hashFrame());
  assert.equal(wideShadow.getPixel(8, 37) !== null, true, 'Wide wall must cast shadow beneath left flank');
  assert.equal(narrowShadow.getPixel(8, 37), null, 'Narrow tower must NOT cast fake wide oval beneath x=8');
});

test('Every model exports valid standalone TypeScript (.ts) and lossless JSON (.json)', () => {
  for (const model of ALL_MODELS) {
    const tsCode = generateStandaloneModelTs(model, { kingdomId: 'red', phenotypeId: 'skin_dark' });
    assert.ok(tsCode.includes(`"id": "${model.id}"`), `${model.id} TS export must contain MODEL_META id`);
    assert.ok(tsCode.includes(`"tier": "${model.tier}"`), `${model.id} TS export must contain MODEL_META tier`);
    assert.ok(tsCode.includes('export function renderModelFrame('), `${model.id} TS export must expose renderModelFrame`);
    assert.ok(tsCode.includes('export function renderToCanvas('), `${model.id} TS export must expose renderToCanvas`);

    const jsonText = generateModelJson(model, { kingdomId: 'blue' });
    const parsed = JSON.parse(jsonText) as {
      id: string;
      tier: string;
      width: number;
      height: number;
      frameCount: number;
      palette: string[];
      frames: { index: number; opaquePixels: number; rle: string }[];
    };

    assert.equal(parsed.id, model.id);
    assert.equal(parsed.tier, model.tier);
    assert.equal(parsed.width, model.width);
    assert.equal(parsed.height, model.height);
    assert.equal(parsed.frameCount, model.frameCount);
    assert.equal(parsed.frames.length, model.frameCount);
    assert.ok(parsed.palette.length >= 4, `${model.id} JSON palette must list colors`);

    // Verify lossless RLE pixel count matches raw renderFrame(0)
    const tokens = parsed.frames[0].rle.split(',');
    let totalGridCells = 0;
    let decodedOpaque = 0;
    for (const tok of tokens) {
      const [cntStr, idxStr] = tok.split(':');
      const cnt = Number(cntStr);
      const idx = Number(idxStr);
      totalGridCells += cnt;
      if (idx >= 0) decodedOpaque += cnt;
    }
    assert.equal(totalGridCells, model.width * model.height, `${model.id} RLE must decode exact grid area`);
    assert.equal(
      decodedOpaque,
      parsed.frames[0].opaquePixels,
      `${model.id} RLE opaque pixel count must match frame0`
    );
  }
});

test('Distortus rex boss animates 20 frames with 4-phase rear-smash-grab-bite attack, swim, combat states, and bounds padding', () => {
  const drex = ALL_MODELS.find((m) => m.id === 'distortus-rex');
  assert.ok(drex, 'distortus-rex must exist in ALL_MODELS');
  assert.equal(drex.width, 68);
  assert.equal(drex.height, 56);
  assert.equal(drex.frameCount, 20);
  assert.ok(drex.attackName && drex.attackName.length > 8);

  const normalHashes = new Set<string>();
  const attackHashes = new Set<string>();
  let attackDiffCount = 0;

  for (let f = 0; f < drex.frameCount; f++) {
    const walkBuf = drex.renderFrame(f, drex.frameCount, { unitMode: 'walk', unitAction: 'normal' });
    const atkBuf = drex.renderFrame(f, drex.frameCount, { unitMode: 'walk', unitAction: 'attack' });

    assert.ok(walkBuf.countOpaquePixels() >= 900, `D-Rex frame ${f} must have massive colossal silhouette`);
    assert.ok(atkBuf.countOpaquePixels() >= 900, `D-Rex attack frame ${f} must have massive colossal silhouette`);

    // Ensure 1px outer frame edge stays clean across walk and attack frames (no edge clipping)
    for (let x = 0; x < drex.width; x++) {
      assert.equal(walkBuf.getPixel(x, 0), null, `D-Rex walk frame ${f} top border clipped at x=${x}`);
      assert.equal(atkBuf.getPixel(x, 0), null, `D-Rex attack frame ${f} top border clipped at x=${x}`);
    }

    const wh = walkBuf.hashFrame();
    const ah = atkBuf.hashFrame();
    normalHashes.add(wh);
    attackHashes.add(ah);
    if (wh !== ah) attackDiffCount++;
  }

  assert.ok(normalHashes.size >= 10, `D-Rex walk must have >= 10 distinct frames (got ${normalHashes.size})`);
  assert.ok(attackHashes.size >= 14, `D-Rex attack must have >= 14 distinct frames (got ${attackHashes.size})`);
  assert.ok(attackDiffCount >= 14, `D-Rex 4-phase attack must differ from walk across >= 14 frames (got ${attackDiffCount})`);

  const orig = renderModelWithContext(drex, 0, { kingdomId: 'original' });
  const hit = renderModelWithContext(drex, 3, { unitAction: 'hit' });
  const death = renderModelWithContext(drex, 8, { unitAction: 'death' });
  const zombie = renderModelWithContext(drex, 0, { unitAction: 'zombie' });
  assert.notEqual(orig.hashFrame(), hit.hashFrame());
  assert.notEqual(orig.hashFrame(), death.hashFrame());
  assert.notEqual(orig.hashFrame(), zombie.hashFrame());
});

test('All 7 BIOME_CREATURE_MODELS animate, execute unique attacks, recolor K1/K2, and support hit/death/zombie', () => {
  assert.equal(BIOME_CREATURE_MODELS.length, 7);

  for (const creature of BIOME_CREATURE_MODELS) {
    assert.ok(creature.attackName && creature.attackName.trim().length > 6, `${creature.id} needs attackName`);
    assert.ok(creature.frameCount >= 12, `${creature.id} must have >= 12 frames`);

    const walkHashes = new Set<string>();
    const atkHashes = new Set<string>();
    let diffCount = 0;

    for (let f = 0; f < creature.frameCount; f++) {
      const walkBuf = creature.renderFrame(f, creature.frameCount, { unitMode: 'walk', unitAction: 'normal' });
      const atkBuf = creature.renderFrame(f, creature.frameCount, { unitMode: 'walk', unitAction: 'attack' });
      assert.equal(walkBuf.width, creature.width);
      assert.equal(walkBuf.height, creature.height);
      assert.ok(walkBuf.countOpaquePixels() >= 140, `${creature.id} frame ${f} must have rich silhouette`);
      const wh = walkBuf.hashFrame();
      const ah = atkBuf.hashFrame();
      walkHashes.add(wh);
      atkHashes.add(ah);
      if (wh !== ah) diffCount++;
    }

    assert.ok(walkHashes.size >= 6, `${creature.id} walk must animate >= 6 distinct frames (got ${walkHashes.size})`);
    assert.ok(atkHashes.size >= 6, `${creature.id} attack must animate >= 6 distinct frames (got ${atkHashes.size})`);
    assert.ok(diffCount >= 6, `${creature.id} attack must differ from walk across >= 6 frames (got ${diffCount})`);

    const orig = renderModelWithContext(creature, 0, { kingdomId: 'original' });
    const hit = renderModelWithContext(creature, 3, { unitAction: 'hit' });
    const death = renderModelWithContext(creature, 6, { unitAction: 'death' });
    const zombie = renderModelWithContext(creature, 0, { unitAction: 'zombie' });
    assert.notEqual(orig.hashFrame(), hit.hashFrame(), `${creature.id} hit must mutate frame`);
    assert.notEqual(orig.hashFrame(), death.hashFrame(), `${creature.id} death must mutate frame`);
    assert.notEqual(orig.hashFrame(), zombie.hashFrame(), `${creature.id} zombie must mutate frame`);
  }
});

test('All 5 biomes populate structures, nature, substances, creatures, weather, and valid patrol/hit-testing', () => {
  assert.equal(BIOMES.length, 5);
  const byId = new Map(ALL_MODELS.map((m) => [m.id, m]));

  for (const biome of BIOMES) {
    const backdrop = renderBiomeBackdrop(biome);
    assert.equal(backdrop.width, BIOME_WIDTH);
    assert.equal(backdrop.height, BIOME_HEIGHT);
    assert.equal(backdrop.countOpaquePixels(), BIOME_WIDTH * BIOME_HEIGHT, `${biome.id} backdrop must cover full 640x360 grid`);

    let structures = 0;
    let nature = 0;
    let substances = 0;
    let creatures = 0;
    let weather = 0;

    const steppedList = biome.placements.map((pl) => {
      const m = byId.get(pl.modelId);
      assert.ok(m, `Biome ${biome.id} placement ${pl.id} references unknown modelId "${pl.modelId}"`);
      if (m.kind === 'static' || m.kind === 'animated') structures++;
      else if (m.kind === 'nature') nature++;
      else if (m.kind === 'substance') substances++;
      else if (m.kind === 'unit' || m.kind === 'aquatic') creatures++;
      else if (m.kind === 'weather') weather++;

      const s = stepBiomePlacement(pl, m, 2.5);
      assert.ok(s.x >= 20 && s.x <= BIOME_WIDTH - 20, `${biome.id}:${pl.id} stepped x=${s.x} out of bounds`);
      assert.ok(s.y >= 30 && s.y <= BIOME_HEIGHT + 4, `${biome.id}:${pl.id} stepped y=${s.y} out of bounds`);

      if (pl.layer === 'water') {
        assert.equal(
          isBiomeWaterPixel(biome.id, pl.x, pl.y - 6),
          true,
          `${biome.id}:${pl.id} water entity at (${pl.x},${pl.y}) must sit in water tile`
        );
      } else if (pl.layer === 'ground') {
        assert.equal(
          isBiomeWaterPixel(biome.id, pl.x, pl.y - 4),
          false,
          `${biome.id}:${pl.id} ground entity at (${pl.x},${pl.y}) must sit on land tile`
        );
      }
      return s;
    });

    assert.ok(structures >= 3, `Biome ${biome.id} needs >= 3 structures (got ${structures})`);
    assert.ok(nature >= 2, `Biome ${biome.id} needs >= 2 nature models (got ${nature})`);
    assert.ok(substances >= 1, `Biome ${biome.id} needs >= 1 substance (got ${substances})`);
    assert.ok(creatures >= 5, `Biome ${biome.id} needs >= 5 creatures/units (got ${creatures})`);
    assert.ok(weather >= 1, `Biome ${biome.id} needs >= 1 weather overlay (got ${weather})`);

    // Hit testing a ground entity returns a valid non-weather entity
    const target = steppedList.find((e) => e.model.kind === 'unit' || e.model.kind === 'static');
    assert.ok(target);
    const hit = hitTestBiomeEntities(
      steppedList,
      target.drawX + target.model.width / 2,
      target.drawY + target.model.height / 2
    );
    assert.ok(hit !== null, `Hit test at center of ${target.placement.id} in ${biome.id} must resolve an entity`);
    assert.notEqual(hit.model.kind, 'weather');
  }
});

test('PixelSandbox 2D sprite adapter keeps sprites borderless, strips aquatic water boxes, and casts diagonal ground shadows', () => {
  const oak = ALL_MODELS.find((m) => m.id === 'ancient-oak');
  const mosa = ALL_MODELS.find((m) => m.id === 'mosasaurus');
  assert.ok(oak && mosa);

  const rawOak = renderModelWithContext(oak, 0, { showShadow: false });
  const adaptedOak = toPixelSandboxSprite(rawOak, { isAquatic: false, isWeather: false });
  let adaptedInk = 0;
  for (let y = 0; y < adaptedOak.height; y++) {
    for (let x = 0; x < adaptedOak.width; x++) {
      if (adaptedOak.getPixel(x, y) === INK.toUpperCase()) adaptedInk++;
    }
  }
  assert.equal(adaptedInk, 0, 'PixelSandbox-adapted oak must have zero harsh INK black outlines');

  const sh = buildPixelSandboxCastShadow(adaptedOak, '#142B084C');
  assert.ok(sh.buffer.countOpaquePixels() >= 50, 'PixelSandbox cast shadow must project diagonal silhouette pixels');

  const rawMosa = renderModelWithContext(mosa, 0, { showShadow: false });
  const adaptedMosa = toPixelSandboxSprite(rawMosa, { isAquatic: true, isWeather: false });
  assert.ok(
    adaptedMosa.countOpaquePixels() < rawMosa.countOpaquePixels() - 50,
    'PixelSandbox aquatic adapter must strip baked rectangular water tint box'
  );
  // Corner bottom pixel of raw mosasaurus water box (x=3, y=height-3) must be stripped
  assert.equal(adaptedMosa.getPixel(3, adaptedMosa.height - 3), null);
});

test('Gustave crocodile boss renders 64x36 scarred silhouette, 4-phase Death Roll attack, swim WATER_LINE, K1/K2, and soft shadow', () => {
  const gustave = ALL_MODELS.find((m) => m.id === 'gustave-crocodile');
  assert.ok(gustave, 'gustave-crocodile must exist in ALL_MODELS');
  assert.equal(gustave.width, 64);
  assert.equal(gustave.height, 36);
  assert.equal(gustave.frameCount, 16);
  assert.equal(gustave.tier, 'III');
  assert.ok(gustave.attackName && gustave.attackName.includes('вращение'));
  assert.ok(gustave.getAnchors, 'gustave-crocodile must expose getAnchors');

  const walkHashes = new Set<string>();
  const attackHashes = new Set<string>();
  let diffCount = 0;

  for (let f = 0; f < gustave.frameCount; f++) {
    const walkBuf = gustave.renderFrame(f, gustave.frameCount, { unitMode: 'walk', unitAction: 'normal' });
    const atkBuf = gustave.renderFrame(f, gustave.frameCount, { unitMode: 'walk', unitAction: 'attack' });

    assert.ok(walkBuf.countOpaquePixels() >= 380, `Gustave frame ${f} must have massive armored silhouette`);
    assert.ok(atkBuf.countOpaquePixels() >= 380, `Gustave attack frame ${f} must have massive armored silhouette`);

    // Top row and side edges must remain clear of clipping
    for (let x = 0; x < gustave.width; x++) {
      assert.equal(walkBuf.getPixel(x, 0), null, `Gustave walk frame ${f} top border clipped at x=${x}`);
      assert.equal(atkBuf.getPixel(x, 0), null, `Gustave attack frame ${f} top border clipped at x=${x}`);
    }
    for (let y = 0; y < gustave.height; y++) {
      assert.equal(walkBuf.getPixel(0, y), null, `Gustave walk frame ${f} left edge clipped at y=${y}`);
      assert.equal(walkBuf.getPixel(gustave.width - 1, y), null, `Gustave walk frame ${f} right edge clipped at y=${y}`);
    }

    const wh = walkBuf.hashFrame();
    const ah = atkBuf.hashFrame();
    walkHashes.add(wh);
    attackHashes.add(ah);
    if (wh !== ah) diffCount++;
  }

  assert.ok(walkHashes.size >= 8, `Gustave walk must have >= 8 distinct frames (got ${walkHashes.size})`);
  assert.ok(attackHashes.size >= 12, `Gustave attack must have >= 12 distinct frames (got ${attackHashes.size})`);
  assert.ok(diffCount >= 12, `Gustave Death Roll attack must differ from walk across >= 12 frames (got ${diffCount})`);

  // Swim mode check with WATER_LINE
  const swimBuf = gustave.renderFrame(0, gustave.frameCount, { unitMode: 'swim', unitAction: 'normal' });
  let hasWaterline = false;
  for (let y = 0; y < swimBuf.height; y++) {
    for (let x = 0; x < swimBuf.width; x++) {
      const px = swimBuf.getPixel(x, y);
      if (px === WATER_LINE.light || px === WATER_LINE.mid) hasWaterline = true;
    }
  }
  assert.equal(hasWaterline, true, 'Gustave swim frame must render WATER_LINE ripples');

  // Recolor & combat state checks
  const orig = renderModelWithContext(gustave, 0, { kingdomId: 'original' });
  const blue = renderModelWithContext(gustave, 0, { kingdomId: 'blue' });
  const hit = renderModelWithContext(gustave, 3, { unitAction: 'hit' });
  const death = renderModelWithContext(gustave, 6, { unitAction: 'death' });
  const zombie = renderModelWithContext(gustave, 0, { unitAction: 'zombie' });
  assert.notEqual(orig.hashFrame(), blue.hashFrame());
  assert.notEqual(orig.hashFrame(), hit.hashFrame());
  assert.notEqual(orig.hashFrame(), death.hashFrame());
  assert.notEqual(orig.hashFrame(), zombie.hashFrame());
});

test('All geological ore deposits, Acid Geyser, 3 Tornado intensity degrees, and Earthquake Rift satisfy visual & animation checks', () => {
  const oreIds = [
    'ore-stone-deposit',
    'ore-iron-deposit',
    'ore-silver-deposit',
    'gold-quartz-vein',
    'ore-mythril-deposit',
    'ore-adamantine-deposit',
    'ore-ruby-gem-deposit',
    'acid-geyser',
  ];
  for (const id of oreIds) {
    const model = ALL_MODELS.find((m) => m.id === id);
    assert.ok(model, `Missing ore/geyser model: ${id}`);
    const frame0 = model.renderFrame(0, model.frameCount);
    assert.ok(frame0.countOpaquePixels() >= 280, `${id} expected >= 280 opaque pixels`);
    // Ensure outer 1px borders are clean (no clipping)
    for (let x = 0; x < model.width; x++) {
      assert.equal(frame0.getPixel(x, 0), null, `${id} top clipped at x=${x}`);
    }
    for (let y = 0; y < model.height; y++) {
      assert.equal(frame0.getPixel(0, y), null, `${id} left clipped at y=${y}`);
      assert.equal(frame0.getPixel(model.width - 1, y), null, `${id} right clipped at y=${y}`);
    }
  }

  // Verify 3 distinct tornado degrees scale progressively in pixel footprint & width
  const t1 = ALL_MODELS.find((m) => m.id === 'vfx-dust-devil');
  const t2 = ALL_MODELS.find((m) => m.id === 'vfx-tornado');
  const t3 = ALL_MODELS.find((m) => m.id === 'vfx-mega-tornado');
  const eq = ALL_MODELS.find((m) => m.id === 'vfx-earthquake-rift');
  assert.ok(t1 && t2 && t3 && eq);

  const px1 = t1.renderFrame(0, t1.frameCount).countOpaquePixels();
  const px2 = t2.renderFrame(0, t2.frameCount).countOpaquePixels();
  const px3 = t3.renderFrame(0, t3.frameCount).countOpaquePixels();
  assert.ok(px1 < px2 && px2 < px3, `Tornado degrees must scale in density (${px1} < ${px2} < ${px3})`);

  const eqHashes = new Set<string>();
  for (let f = 0; f < eq.frameCount; f++) {
    eqHashes.add(eq.renderFrame(f, eq.frameCount).hashFrame());
  }
  assert.ok(eqHashes.size >= 8, 'Earthquake rift must animate across >= 8 unique frames');
});

test('Interactive biomeSimulation: Earthquakes mutate terrain tiles, carve cracks, destroy structures, and damage creatures', () => {
  const byId = new Map(ALL_MODELS.map((m) => [m.id, m]));
  const forest = BIOMES[0];
  const state = createBiomeSimState(forest, byId);

  assert.equal(state.tileMap.length, 160 * 90);
  const initialHash = renderBiomeSimBackdrop(forest, state).hashFrame();
  assert.equal(state.backdropDirty, false);

  // Find a populated settlement area containing a structure and a creature
  const targetStruct = state.entities.find((e) => e.model.kind === 'static' || e.model.kind === 'animated');
  const targetCreature = state.entities.find((e) => e.model.kind === 'unit');
  assert.ok(targetStruct && targetCreature);

  // Trigger earthquake centered directly on that structure
  applyEarthquakeAt(state, forest, targetStruct.x, targetStruct.y);
  assert.equal(state.quakeCount, 1);
  assert.equal(state.backdropDirty, true);
  assert.ok(state.shakeTimer > 0.5);

  // Verify terrain tiles actually mutated (shore uplifted crust & rock ridges + cracks)
  let shoreCount = 0;
  let rockCount = 0;
  let crackCount = 0;
  for (let i = 0; i < state.tileMap.length; i++) {
    if (state.crackMap[i] > 0) {
      crackCount++;
      if (state.tileMap[i] === 'shore') shoreCount++;
      if (state.tileMap[i] === 'rock') rockCount++;
    }
  }
  assert.ok(crackCount >= 20, `Earthquake must carve >= 20 fissure crack tiles (got ${crackCount})`);
  assert.ok(rockCount >= 4, `Earthquake must uplift central rock ridge tiles (got ${rockCount})`);
  assert.ok(shoreCount >= 4, `Earthquake must uplift pale sand/crust collar tiles (got ${shoreCount})`);

  // Structure directly at epicenter must take heavy/lethal damage and alter backdrop pixels
  assert.ok(targetStruct.hp < targetStruct.maxHp, 'Structure near epicenter must lose HP');
  const postQuakeHash = renderBiomeSimBackdrop(forest, state).hashFrame();
  assert.notEqual(postQuakeHash, initialHash, 'Earthquake must visibly alter 640x360 terrain pixels');

  // Second quake right on a creature inflicts damage, hit timer, and popups
  const prevHp = targetCreature.hp;
  applyEarthquakeAt(state, forest, targetCreature.x, targetCreature.y);
  assert.ok(targetCreature.hp < prevHp, 'Creature near earthquake must take real HP damage');
  assert.ok(targetCreature.hitTimer > 0, 'Damaged creature must enter hit animation timer');
  assert.ok(state.totalDamageDealt > 0);
  assert.ok(state.popups.length > 0);

  // Spawn Mega Tornado & Acid Geyser and advance simulation ticks
  const tornadoModel = byId.get('vfx-mega-tornado');
  const acidModel = byId.get('acid-geyser');
  assert.ok(tornadoModel && acidModel);
  const spawnedTornado = spawnBiomeModelAt(state, tornadoModel, targetCreature.x, targetCreature.y);
  const spawnedAcid = spawnBiomeModelAt(state, acidModel, 260, 180);
  assert.ok(state.entities.some((e) => e.id === spawnedTornado.id));
  assert.ok(state.entities.some((e) => e.id === spawnedAcid.id));

  for (let step = 0; step < 12; step++) {
    stepBiomeSim(state, forest, 0.1, step * 0.1);
  }
  assert.ok(state.shakeTimer < 0.75, 'Shake timer must decay during simulation');
  assert.equal(removeBiomeEntityById(state, spawnedAcid.id), true);
  assert.equal(state.entities.some((e) => e.id === spawnedAcid.id), false);
});

test('Alliance Monarch (alliance-monarch) renders 40x38 supreme regalia, K1+K2+SKIN masks, all phenotypes, and 12-frame halo animation', () => {
  const monarch = ALL_MODELS.find((m) => m.id === 'alliance-monarch');
  assert.ok(monarch, 'alliance-monarch must exist in ALL_MODELS');
  assert.equal(monarch.width, 40);
  assert.equal(monarch.height, 38);
  assert.equal(monarch.tier, 'III');
  assert.equal(monarch.frameCount, 12);
  assert.equal(monarch.unitMeta?.usesSkinMask, true);

  const raw0 = monarch.renderFrame(0, monarch.frameCount);
  const stats = raw0.countPixelStats();
  assert.ok(stats.k1Pixels > 20, 'Alliance Monarch must contain primary kingdom K1_MASK pixels');
  assert.ok(stats.k2Pixels > 20, 'Alliance Monarch must contain allied kingdom K2_MASK pixels');
  assert.ok(stats.skinPixels > 10, 'Alliance Monarch must contain SKIN_MASK pixels');

  const phenotypes = [
    'skin_light',
    'skin_medium',
    'skin_dark',
    'skin_pale',
    'skin_green',
    'skin_blue',
    'skin_red',
    'skin_purple',
  ] as const;
  const phenoHashes = new Set<string>();
  for (const phenotypeId of phenotypes) {
    phenoHashes.add(renderModelWithContext(monarch, 0, { kingdomId: 'red', phenotypeId }).hashFrame());
  }
  assert.equal(phenoHashes.size, phenotypes.length, 'Alliance Monarch must visibly adapt to all 8 skin phenotypes');
});

test('Tyrannosaurus rex renders 68x52 apex theropod silhouette, 4-phase bite-and-roar attack, swim WATER_LINE, K1/K2, and bounds padding', () => {
  const trex = ALL_MODELS.find((m) => m.id === 'tyrannosaurus-rex');
  assert.ok(trex, 'tyrannosaurus-rex must exist in ALL_MODELS');
  assert.equal(trex.width, 68);
  assert.equal(trex.height, 52);
  assert.equal(trex.frameCount, 16);
  assert.equal(trex.tier, 'III');
  assert.ok(trex.getAnchors, 'tyrannosaurus-rex must expose getAnchors');

  const walkHashes = new Set<string>();
  const attackHashes = new Set<string>();
  let diffCount = 0;

  for (let f = 0; f < trex.frameCount; f++) {
    const walkBuf = trex.renderFrame(f, trex.frameCount, { unitMode: 'walk', unitAction: 'normal' });
    const atkBuf = trex.renderFrame(f, trex.frameCount, { unitMode: 'walk', unitAction: 'attack' });

    assert.ok(walkBuf.countOpaquePixels() >= 550, `T-Rex walk frame ${f} expected >= 550 opaque pixels`);
    assert.ok(atkBuf.countOpaquePixels() >= 550, `T-Rex attack frame ${f} expected >= 550 opaque pixels`);

    for (let x = 0; x < trex.width; x++) {
      assert.equal(walkBuf.getPixel(x, 0), null, `T-Rex walk frame ${f} top edge clipped at x=${x}`);
      assert.equal(atkBuf.getPixel(x, 0), null, `T-Rex attack frame ${f} top edge clipped at x=${x}`);
    }
    for (let y = 0; y < trex.height; y++) {
      assert.equal(walkBuf.getPixel(0, y), null, `T-Rex walk frame ${f} left edge clipped at y=${y}`);
      assert.equal(walkBuf.getPixel(trex.width - 1, y), null, `T-Rex walk frame ${f} right edge clipped at y=${y}`);
      assert.equal(atkBuf.getPixel(0, y), null, `T-Rex attack frame ${f} left edge clipped at y=${y}`);
      assert.equal(atkBuf.getPixel(trex.width - 1, y), null, `T-Rex attack frame ${f} right edge clipped at y=${y}`);
    }

    const wh = walkBuf.hashFrame();
    const ah = atkBuf.hashFrame();
    walkHashes.add(wh);
    attackHashes.add(ah);
    if (wh !== ah) diffCount++;
  }

  assert.ok(walkHashes.size >= 8, `T-Rex walk must have >= 8 distinct frames (got ${walkHashes.size})`);
  assert.ok(attackHashes.size >= 12, `T-Rex attack must have >= 12 distinct frames (got ${attackHashes.size})`);
  assert.ok(diffCount >= 12, `T-Rex attack must differ from walk across >= 12 frames (got ${diffCount})`);

  // Swim WATER_LINE check
  const swimBuf = trex.renderFrame(0, trex.frameCount, { unitMode: 'swim', unitAction: 'normal' });
  let hasWaterline = false;
  for (let y = 0; y < swimBuf.height; y++) {
    for (let x = 0; x < swimBuf.width; x++) {
      const px = swimBuf.getPixel(x, y);
      if (px === WATER_LINE.light || px === WATER_LINE.mid) hasWaterline = true;
    }
  }
  assert.equal(hasWaterline, true, 'T-Rex swim frame must render WATER_LINE ripples');

  const orig = renderModelWithContext(trex, 0, { kingdomId: 'original' });
  const red = renderModelWithContext(trex, 0, { kingdomId: 'red' });
  const hit = renderModelWithContext(trex, 3, { unitAction: 'hit' });
  const death = renderModelWithContext(trex, 6, { unitAction: 'death' });
  const zombie = renderModelWithContext(trex, 0, { unitAction: 'zombie' });
  assert.notEqual(orig.hashFrame(), red.hashFrame());
  assert.notEqual(orig.hashFrame(), hit.hashFrame());
  assert.notEqual(orig.hashFrame(), death.hashFrame());
  assert.notEqual(orig.hashFrame(), zombie.hashFrame());
});

test('All Era species, human era units, and Wildlife animals render borderless, animate idle/walk/attack/death/swim, recolor K1/K2, and mutate via CreatureGenes', () => {
  const eraNew = [
    ...ERA_DINOSAUR_MODELS,
    ...ERA_MEGAFAUNA_MODELS,
    ...ERA_STONE_AGE_MODELS,
    ...ERA_BRONZE_UNITS,
    ...ERA_MEDIEVAL_UNITS,
    ...WILDLIFE_CREATURE_MODELS,
  ];
  assert.equal(eraNew.length, 36);

  for (const model of eraNew) {
    assert.ok(model.era, `${model.id} must declare an era`);
    const idle0 = renderModelWithContext(model, 0, { unitAction: 'idle', kingdomId: 'original', showShadow: false });
    const walk0 = renderModelWithContext(model, 0, { unitAction: 'normal', kingdomId: 'original', showShadow: false });
    const atkMid = renderModelWithContext(model, Math.floor(model.frameCount * 0.5), { unitAction: 'attack', kingdomId: 'original', showShadow: false });
    const deathEnd = renderModelWithContext(model, Math.max(1, model.frameCount - 2), { unitAction: 'death', kingdomId: 'original', showShadow: false });
    const swim0 = renderModelWithContext(model, 0, { unitMode: 'swim', unitAction: 'normal', kingdomId: 'original', showShadow: false });

    assert.ok(idle0.countOpaquePixels() >= 25, `${model.id} idle frame must be visible`);
    assert.ok(walk0.countOpaquePixels() >= 25, `${model.id} walk frame must be visible`);

    // Strictly borderless: ZERO black #131110 outline pixels
    for (let y = 0; y < walk0.height; y++) {
      for (let x = 0; x < walk0.width; x++) {
        assert.notEqual(walk0.getPixel(x, y), INK.toUpperCase(), `${model.id} must have zero INK black outline pixels`);
      }
    }

    // Distinct action states (attack & death differ from walk/idle) & full walk cycle
    assert.notEqual(walk0.hashFrame(), atkMid.hashFrame(), `${model.id} attack must differ from walk`);
    assert.notEqual(idle0.hashFrame(), deathEnd.hashFrame(), `${model.id} death must differ from idle`);
    const walkHashes = new Set<string>();
    for (let f = 0; f < model.frameCount; f++) {
      walkHashes.add(renderModelWithContext(model, f, { unitAction: 'normal', showShadow: false }).hashFrame());
    }
    assert.ok(walkHashes.size >= 4, `${model.id} walk must animate across >= 4 unique frames (got ${walkHashes.size})`);

    // Swim mode shows upper body above WATER_LINE ripples
    let hasWater = false;
    for (let y = 0; y < swim0.height; y++) {
      for (let x = 0; x < swim0.width; x++) {
        const px = swim0.getPixel(x, y);
        if (px === WATER_LINE.light || px === WATER_LINE.mid) hasWater = true;
      }
    }
    assert.equal(hasWater, true, `${model.id} swim must display WATER_LINE ripples`);

    // Kingdom mask recolor + Gene mutations produce distinct subspecies
    const redVariant = renderModelWithContext(model, 0, { kingdomId: 'red', showShadow: false });
    const compactAlbino = renderModelWithContext(model, 0, {
      kingdomId: 'original',
      showShadow: false,
      genes: { size: 'compact', coat: 'albino', appendages: 'none', biomeTint: 'tundra' },
    });
    const colossalOrnate = renderModelWithContext(model, 0, {
      kingdomId: 'original',
      showShadow: false,
      genes: { size: 'colossal', coat: 'dark', appendages: 'ornate', biomeTint: 'volcanic' },
    });

    assert.notEqual(walk0.hashFrame(), redVariant.hashFrame(), `${model.id} must support K1/K2 kingdom recolor`);
    assert.notEqual(walk0.hashFrame(), compactAlbino.hashFrame(), `${model.id} must mutate with compact/albino/tundra genes`);
    assert.notEqual(compactAlbino.hashFrame(), colossalOrnate.hashFrame(), `${model.id} subspecies gene presets must differ`);
  }

  // All human era units respond to SKIN_MASK phenotypes
  const humanUnits = [
    ...ERA_STONE_AGE_MODELS.filter((m) => m.unitMeta?.usesSkinMask),
    ...ERA_BRONZE_UNITS,
    ...ERA_MEDIEVAL_UNITS,
  ];
  assert.equal(humanUnits.length, 16);
  for (const human of humanUnits) {
    const light = renderModelWithContext(human, 0, { phenotypeId: 'skin_light', showShadow: false });
    const green = renderModelWithContext(human, 0, { phenotypeId: 'skin_green', showShadow: false });
    assert.notEqual(light.hashFrame(), green.hashFrame(), `${human.id} must adapt to SKIN_MASK phenotypes`);
  }

  // Unified mega-mammoth supports glacial frost-crusted subspecies via tundra/albino genes
  const mammoth = ALL_MODELS.find((m) => m.id === 'mega-mammoth');
  assert.ok(mammoth);
  assert.equal(ALL_MODELS.some((m) => m.id === 'polar-mammoth'), false, 'Duplicate polar-mammoth must be removed');
  const normalMammoth = renderModelWithContext(mammoth, 0, { showShadow: false, genes: { biomeTint: 'none' } });
  const glacialMammoth = renderModelWithContext(mammoth, 0, { showShadow: false, genes: { biomeTint: 'tundra' } });
  assert.notEqual(normalMammoth.hashFrame(), glacialMammoth.hashFrame());
});

test('BakedSpriteAtlas packs model variants onto 1024x1024 pages and serves 20,000+ instanced creature draws from cache', () => {
  const atlas = new BakedSpriteAtlas(1024);
  const compy = ERA_DINOSAUR_MODELS[0];
  const first = atlas.getOrBake('test_compy_0', () => renderModelWithContext(compy, 0));
  const second = atlas.getOrBake('test_compy_0', () => renderModelWithContext(compy, 0));
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.deepEqual(first.region, second.region);

  const eraModels = [...ERA_DINOSAUR_MODELS, ...ERA_MEGAFAUNA_MODELS, ...ERA_STONE_AGE_MODELS];
  const bench = runAtlasInstancingBenchmark(eraModels, renderModelWithContext, 20000);
  assert.equal(bench.entityCount, 20000);
  assert.ok(bench.pagesUsed >= 1, 'Atlas benchmark must allocate at least 1 page');
  assert.equal(bench.cacheHits + bench.cacheMisses, 20000);
  assert.ok(bench.cacheHits >= 19700, `Expected >= 19700 atlas cache hits across 20,000 draws (got ${bench.cacheHits})`);
});

test('Strict 9-era classification & EntityType filter prevent anachronisms and verify Era×Type summary matrix', () => {
  const validEras = new Set(ERA_TABS.filter((e) => e.id !== 'all').map((e) => e.id));
  const validTypes = new Set(ENTITY_TYPE_TABS.filter((t) => t.id !== 'all').map((t) => t.id));
  const seenIds = new Set<string>();

  for (const model of ALL_MODELS) {
    assert.equal(seenIds.has(model.id), false, `Duplicate model ID detected: ${model.id}`);
    seenIds.add(model.id);

    const era = getModelEra(model);
    const entityType = getModelEntityType(model);
    assert.ok(validEras.has(era), `${model.id} has invalid era: ${era}`);
    assert.ok(validTypes.has(entityType), `${model.id} has invalid entityType: ${entityType}`);

    if (era === 'primordial' || era === 'dinosaurs') {
      assert.notEqual(entityType, 'building', `Era ${era} must NOT contain building ${model.id}`);
      assert.notEqual(entityType, 'unit', `Era ${era} must NOT contain unit ${model.id}`);
    }
    if (era === 'common-nature') {
      assert.equal(entityType, 'nature', `common-nature must contain only nature items (got ${model.id})`);
    }
    if (era === 'wildlife') {
      assert.equal(entityType, 'creature', `wildlife must contain only real wild creatures (got ${model.id})`);
    }

    if (entityType === 'building') {
      const fn = getModelBuildingFunction(model);
      assert.ok(fn, `Building ${model.id} must resolve a valid BuildingFunction`);
    }
  }

  // Specific historical fixes
  const dolmen = ALL_MODELS.find((m) => m.id === 'mossy-dolmen');
  const clocktower = ALL_MODELS.find((m) => m.id === 'guild-clocktower');
  assert.ok(dolmen && clocktower);
  assert.equal(getModelEra(dolmen), 'stone-age');
  assert.equal(getModelEntityType(dolmen), 'building');
  assert.equal(getModelEra(clocktower), 'mythic');
  assert.equal(getModelEntityType(clocktower), 'building');

  // Human eras have 6+ distinct human units
  assert.ok(filterModels(ALL_MODELS, 'all', 'all', 'stone-age', 'unit').length >= 6);
  assert.ok(filterModels(ALL_MODELS, 'all', 'all', 'bronze-iron', 'unit').length >= 7);
  assert.ok(filterModels(ALL_MODELS, 'all', 'all', 'medieval', 'unit').length >= 11);

  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'primordial', 'building').length, 0);
  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'dinosaurs', 'building').length, 0);
  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'ice-age', 'building').length, 3);
  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'stone-age', 'building').length, 11);
  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'bronze-iron', 'building').length, 10);
  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'medieval', 'building').length, 16);
  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'mythic', 'building').length, 18);
  assert.equal(filterModels(ALL_MODELS, 'all', 'all', 'all', 'building').length, 58);

  // Era × Type summary matrix matches ALL_MODELS.length cleanly
  const summary = getEraTypeSummaryMatrix();
  assert.equal(summary.length, 9);
  const matrixTotal = summary.reduce((acc, row) => acc + row.total, 0);
  assert.equal(matrixTotal, ALL_MODELS.length);
});

test('All 58 buildings support 4 distinct construction/damage states without black outlines', () => {
  const allBuildings = filterModels(ALL_MODELS, 'all', 'all', 'all', 'building');
  assert.equal(allBuildings.length, 58);
  assert.equal(BUILDING_STATE_OPTIONS.length, 4);

  const countInk = (buf: PixelBuffer): number => {
    let count = 0;
    const upperInk = INK.toUpperCase();
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if (buf.getPixel(x, y) === upperInk) count++;
      }
    }
    return count;
  };

  for (const building of allBuildings) {
    const hashes = new Set<string>();
    for (const stateOpt of BUILDING_STATE_OPTIONS) {
      const frame = renderModelWithContext(building, 0, {
        kingdomId: 'original',
        showShadow: false,
        buildingState: stateOpt.id,
      });
      assert.equal(
        countInk(frame),
        0,
        `Building ${building.id} in state ${stateOpt.id} must have 0 INK outlines`
      );
      assert.ok(
        frame.countOpaquePixels() >= 120,
        `Building ${building.id} in state ${stateOpt.id} must have substantial silhouette`
      );
      hashes.add(frame.hashFrame());
    }
    assert.equal(
      hashes.size,
      4,
      `Building ${building.id} must produce 4 distinct frames across constructing/ready/damaged/ruins`
    );
  }

  // All 32 new ERA_STRUCTURE_MODELS must recolor with faction kingdom masks
  for (const model of ERA_STRUCTURE_MODELS) {
    const orig = renderModelWithContext(model, 0, {
      kingdomId: 'original',
      showShadow: false,
      buildingState: 'ready',
    });
    const blue = renderModelWithContext(model, 0, {
      kingdomId: 'blue',
      showShadow: false,
      buildingState: 'ready',
    });
    assert.notEqual(
      orig.hashFrame(),
      blue.hashFrame(),
      `Era structure ${model.id} must recolor banners/roofs on K1/K2 mask change`
    );
  }

  // Prehistoric props must render borderlessly without INK outlines
  assert.equal(ERA_PROP_MODELS.length, 6);
  for (const prop of ERA_PROP_MODELS) {
    const frame = renderModelWithContext(prop, 0, { showShadow: false });
    assert.equal(countInk(frame), 0, `Prop ${prop.id} must have 0 INK outlines`);
    assert.ok(frame.countOpaquePixels() >= 100, `Prop ${prop.id} must have opaque silhouette`);
  }
});

test('Primordial fauna & upgraded aquatic predators animate cleanly with zero INK and K1/K2 recolor', () => {
  const targetAquatic = AQUATIC_MODELS.filter((m) =>
    ['xiphactinus', 'dunkleosteus', 'eurypterid-king'].includes(m.id)
  );
  assert.equal(targetAquatic.length, 3);
  assert.equal(ERA_PRIMORDIAL_MODELS.length, 4);

  const countInk = (buf: PixelBuffer): number => {
    let count = 0;
    const upperInk = INK.toUpperCase();
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if (buf.getPixel(x, y) === upperInk) count++;
      }
    }
    return count;
  };

  for (const model of [...ERA_PRIMORDIAL_MODELS, ...targetAquatic]) {
    const walk0 = renderModelWithContext(model, 0, { unitAction: 'normal', showShadow: false });
    const swim0 = renderModelWithContext(model, 0, { unitMode: 'swim', showShadow: false });
    const red0 = renderModelWithContext(model, 0, {
      kingdomId: 'red',
      unitAction: 'normal',
      showShadow: false,
    });

    assert.equal(countInk(walk0), 0, `${model.id} must have zero INK contours`);
    assert.ok(walk0.countOpaquePixels() >= 80, `${model.id} must render clear silhouette`);
    assert.notEqual(walk0.hashFrame(), red0.hashFrame(), `${model.id} must support K1/K2 recolor`);

    let hasWater = false;
    for (let y = 0; y < swim0.height; y++) {
      for (let x = 0; x < swim0.width; x++) {
        const px = swim0.getPixel(x, y);
        if (px === WATER_LINE.light || px === WATER_LINE.mid) hasWater = true;
      }
    }
    assert.equal(hasWater, true, `${model.id} swim must display WATER_LINE ripples`);
  }

  for (const model of ERA_PRIMORDIAL_MODELS) {
    const attack0 = renderModelWithContext(model, 2, { unitAction: 'attack', showShadow: false });
    const death0 = renderModelWithContext(model, 4, { unitAction: 'death', showShadow: false });
    const walk0 = renderModelWithContext(model, 0, { unitAction: 'normal', showShadow: false });
    const mutated = renderModelWithContext(model, 0, {
      kingdomId: 'original',
      showShadow: false,
      genes: { size: 'colossal', coat: 'albino', appendages: 'ornate', biomeTint: 'volcanic' },
    });

    assert.notEqual(walk0.hashFrame(), attack0.hashFrame(), `${model.id} attack must differ from walk`);
    assert.notEqual(walk0.hashFrame(), death0.hashFrame(), `${model.id} death must differ from walk`);
    assert.notEqual(walk0.hashFrame(), mutated.hashFrame(), `${model.id} genes must mutate appearance`);
  }
});








