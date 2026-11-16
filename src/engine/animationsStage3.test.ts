import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODELS, getModelEntityType } from '../models';
import {
  BUILDING_ANIMATION_SPEC,
  renderAnimatedBuildingFrame,
} from './buildingAnimations';
import {
  CREATURE_ANIMATION_ACTIONS,
  CREATURE_ANIMATION_SPECS,
  getCreatureLocomotionType,
  renderAnimatedCreatureFrame,
} from './creatureAnimations';
import { bakeAnimatedUnitAtlas, bakeAtlas } from './forgeApi';
import { INK } from './palette';
import { PIXEL_VFX_IDS, PIXEL_VFX_SPECS, renderVfxFrame } from './pixelVfx';
import {
  getAllMedievalAndBronzeBuildings,
  packProceduralAtlasBatch,
} from './proceduralBuildingsAndAnimals';
import {
  ACTIVE_UNIT_RACES,
  type ActiveUnitRace,
  UNIT_ANIMATION_ACTIONS,
  UNIT_CARRY_ITEMS,
  type UnitAnimationAction,
  type UnitEra,
  generateProceduralUnit,
  getRaceActionSpec,
} from './proceduralHuman';
import { ALL_RACE_BUILDINGS, MEDIEVAL_TOWN_HALL } from './proceduralRaceBuildings';
import {
  benchmarkAnimatedUnits,
  createVillageSimulation,
  getDefaultEraForRace,
  stepVillageSimulation,
} from './villageSimulation';

function hasSemitransparentPixels(buf: { width: number; height: number; getPixel: (x: number, y: number) => string | null }): number {
  let count = 0;
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const px = buf.getPixel(x, y);
      if (px && px.length === 9) {
        const a = parseInt(px.slice(7, 9), 16);
        if (a > 0 && a < 255) count++;
      }
    }
  }
  return count;
}

test('Stage 3: All 10 active races × 14 actions respect <=8 colors, 0 INK, 0 orphans, 0 semitransparency & distinct frames', () => {
  const nonStaticActions: readonly UnitAnimationAction[] = [
    'walk',
    'run',
    'idle',
    'chop',
    'mine',
    'build',
    'gather',
    'fish',
    'attack-melee',
    'attack-ranged',
    'cast',
    'hit',
    'death',
    'sleep',
  ];

  for (const race of ACTIVE_UNIT_RACES) {
    const era: UnitEra = getDefaultEraForRace(race);
    for (const action of nonStaticActions) {
      const spec = getRaceActionSpec(race, action);
      const hashes = new Set<string>();
      const role =
        action === 'attack-ranged'
          ? 'archer'
          : action === 'cast'
            ? 'cleric'
            : action === 'attack-melee'
              ? 'warrior'
              : 'worker';

      for (let f = 0; f < spec.frameCount; f++) {
        const res = generateProceduralUnit({
          seed: 777,
          era,
          race,
          role,
          action,
          kingdomId: 1,
          frameIndex: f,
        });

        assert.equal(
          res.audit.inkPixels,
          0,
          `${race} ${action} f${f} must have 0 INK pixels`
        );
        assert.equal(
          res.audit.orphanPixels,
          0,
          `${race} ${action} f${f} must have 0 isolated orphan specks`
        );
        assert.equal(
          res.audit.semitransparentPixels,
          0,
          `${race} ${action} f${f} must have 0 semitransparent pixels`
        );
        assert.ok(
          res.audit.uniqueColors <= 8,
          `${race} ${action} f${f} exceeded 8 colors: got ${res.audit.uniqueColors}`
        );
        assert.ok(
          res.audit.opaquePixels >= 10,
          `${race} ${action} f${f} has too few opaque pixels (${res.audit.opaquePixels})`
        );

        // Verify tool/weapon zone tracks dynamic hand anchors (within 1px adjacency)
        if (
          action !== 'sleep' &&
          action !== 'death' &&
          action !== 'idle' &&
          action !== 'hit' &&
          race !== 'hive-mind' &&
          (action === 'chop' ||
            action === 'mine' ||
            action === 'build' ||
            action === 'fish' ||
            action === 'attack-melee' ||
            action === 'attack-ranged' ||
            action === 'cast')
        ) {
          const { rightX, rightY, leftX, leftY } = res.profile.anchors.hand;
          let touchesHand = false;
          for (const [hx, hy] of [
            [rightX, rightY],
            [leftX, leftY],
          ] as const) {
            for (let dy = -1; dy <= 1 && !touchesHand; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const x = hx + dx;
                const y = hy + dy;
                if (x < 0 || x >= 10 || y < 0 || y >= 10) continue;
                const z = res.zoneMap[y * 10 + x];
                if (z === 'metal' || z === 'wood' || z === 'gold' || z === 'status' || z === 'cloth') {
                  touchesHand = true;
                  break;
                }
              }
            }
          }
          assert.ok(
            touchesHand,
            `${race} ${action} f${f} weaponTool must touch hand anchor (${rightX},${rightY}) / (${leftX},${leftY})`
          );
        }

        hashes.add(res.buffer.hashFrame());
      }

      assert.ok(
        hashes.size >= 2,
        `${race} ${action} must animate (at least 2 visually distinct frames, got ${hashes.size})`
      );
    }
  }
});

test('Stage 3: Carry overlays (log, stone, basket) attach on top of walk across all 10 races within <=8 colors', () => {
  const cargos = UNIT_CARRY_ITEMS.filter((c) => c.id !== 'none');
  for (const race of ACTIVE_UNIT_RACES) {
    const era = getDefaultEraForRace(race);
    for (const cargo of cargos) {
      const base = generateProceduralUnit({
        seed: 515,
        era,
        race,
        role: 'worker',
        action: 'walk',
        carry: 'none',
        kingdomId: 2,
        frameIndex: 1,
      });
      const carried = generateProceduralUnit({
        seed: 515,
        era,
        race,
        role: 'worker',
        action: 'walk',
        carry: cargo.id,
        kingdomId: 2,
        frameIndex: 1,
      });

      assert.notEqual(
        carried.buffer.hashFrame(),
        base.buffer.hashFrame(),
        `${race} carrying ${cargo.id} must visibly change sprite`
      );
      assert.ok(
        carried.audit.uniqueColors <= 8,
        `${race} carry ${cargo.id} exceeded 8 colors: ${carried.audit.uniqueColors}`
      );
      assert.equal(carried.audit.inkPixels, 0);
      assert.equal(carried.audit.semitransparentPixels, 0);
    }
  }
});

test('Stage 3: Racial biomechanics — distinct gait timings & hive-mind strictly ignores roles across all actions', () => {
  const antlerWalk = getRaceActionSpec('antlerfolk', 'walk');
  const humanWalk = getRaceActionSpec('human', 'walk');
  const raptorRun = getRaceActionSpec('raptor-kin', 'run');

  assert.ok(
    antlerWalk.frameDurationsMs[0] > humanWalk.frameDurationsMs[0],
    'antlerfolk should walk slower than human'
  );
  assert.ok(
    raptorRun.frameDurationsMs[0] < humanWalk.frameDurationsMs[0],
    'raptor-kin run should be faster than human walk'
  );

  // Marshfolk walk frames 1 & 3 waddle side-to-side cleanly
  const marsh0 = generateProceduralUnit({ seed: 12, race: 'marshfolk', action: 'walk', frameIndex: 0 });
  const marsh1 = generateProceduralUnit({ seed: 12, race: 'marshfolk', action: 'walk', frameIndex: 1 });
  assert.notEqual(marsh0.buffer.hashFrame(), marsh1.buffer.hashFrame());

  // Hive-mind has no roles across all 14 actions
  for (const action of UNIT_ANIMATION_ACTIONS) {
    const asPeasant = generateProceduralUnit({
      seed: 99,
      era: 'primordial',
      race: 'hive-mind',
      role: 'peasant',
      action,
      frameIndex: 1,
    });
    const asKing = generateProceduralUnit({
      seed: 99,
      era: 'primordial',
      race: 'hive-mind',
      role: 'king',
      action,
      frameIndex: 1,
    });
    assert.equal(
      asPeasant.buffer.hashFrame(),
      asKing.buffer.hashFrame(),
      `hive-mind must ignore role on action=${action}`
    );
  }
});

test('Stage 3: All 99 creature/unit models + full 205 catalog models animate across walk/idle/attack/death & phenotypes', () => {
  assert.equal(ALL_MODELS.length, 205);

  // Check every single one of the 205 models across walk (f0, f1), idle (f0, f1), attack (f1), death (f3)
  for (const model of ALL_MODELS) {
    const w0 = renderAnimatedCreatureFrame(model, 'walk', 0, undefined, 0);
    const w1 = renderAnimatedCreatureFrame(model, 'walk', 1, undefined, 0);
    const i0 = renderAnimatedCreatureFrame(model, 'idle', 0, undefined, 0);
    const i1 = renderAnimatedCreatureFrame(model, 'idle', 1, undefined, 0);
    const a1 = renderAnimatedCreatureFrame(model, 'attack', 1, undefined, 0);
    const d3 = renderAnimatedCreatureFrame(model, 'death', 3, undefined, 0);

    for (const res of [w0, w1, i0, i1, a1, d3]) {
      assert.equal(res.inkPixels, 0, `${model.id} ${res.action} f${res.frameIndex} had INK pixels`);
      assert.ok(res.opaquePixels > 0, `${model.id} ${res.action} had empty sprite`);
    }

    assert.notEqual(
      i0.buffer.hashFrame(),
      i1.buffer.hashFrame(),
      `${model.id} idle frame 0 and 1 must visibly animate`
    );

    const et = getModelEntityType(model);
    if (et === 'creature' || et === 'unit') {
      assert.notEqual(
        w0.buffer.hashFrame(),
        w1.buffer.hashFrame(),
        `${model.id} walk frame 0 and 1 must visibly animate`
      );
      // Verify phenotypes work across animations
      const albino = renderAnimatedCreatureFrame(
        model,
        'walk',
        2,
        { coat: 'albino', pattern: 'spotted', size: 'standard', biomeTint: 'tundra', appendages: 'ornate' },
        3
      );
      const natural = renderAnimatedCreatureFrame(
        model,
        'walk',
        2,
        { coat: 'natural', pattern: 'solid', size: 'standard', biomeTint: 'none', appendages: 'standard' },
        0
      );
      assert.notEqual(
        albino.buffer.hashFrame(),
        natural.buffer.hashFrame(),
        `${model.id} creature animation must honor CreatureGenes + kingdom`
      );
      assert.equal(hasSemitransparentPixels(d3.buffer), 0, `${model.id} death frame 3 must be opaque`);
    }
  }

  // Explicitly verify aquatic & flying locomotion classification
  const megalodon = ALL_MODELS.find((m) => m.id === 'megalodon')!;
  const eagle = ALL_MODELS.find((m) => m.id === 'steppe-eagle')!;
  const ptera = ALL_MODELS.find((m) => m.id === 'dino-pteranodon')!;
  assert.equal(getCreatureLocomotionType(megalodon), 'aquatic');
  assert.equal(getCreatureLocomotionType(eagle), 'flying');
  assert.equal(getCreatureLocomotionType(ptera), 'flying');
  for (const act of CREATURE_ANIMATION_ACTIONS) {
    assert.equal(
      CREATURE_ANIMATION_SPECS[act].frameCount,
      act === 'idle' ? 2 : 4
    );
  }
});

test('Stage 3: Building animations (waving K1/K2 flags, smoke, fire, burning) have 0 INK and 0 semitransparent smudge', () => {
  const sampleBuildings = [
    ALL_MODELS.find((m) => m.id === 'citadel-keep')!,
    ALL_MODELS.find((m) => m.id === 'ironclad-armory')!,
    ALL_RACE_BUILDINGS.find((m) => m.id === 'marsh-stilt-hut')!,
    ALL_RACE_BUILDINGS.find((m) => m.id === 'stonekin-monolith')!,
    ALL_RACE_BUILDINGS.find((m) => m.id === 'antler-living-grove')!,
    MEDIEVAL_TOWN_HALL,
    ...getAllMedievalAndBronzeBuildings(ALL_MODELS).slice(0, 3),
  ];

  for (const bModel of sampleBuildings) {
    const readyHashes = new Set<string>();
    const burningHashes = new Set<string>();

    for (let f = 0; f < BUILDING_ANIMATION_SPEC.frameCount; f++) {
      const readyRes = renderAnimatedBuildingFrame(bModel, 2, 'ready', f, {
        burning: false,
        showShadow: false,
      });
      const burnRes = renderAnimatedBuildingFrame(bModel, 2, 'ready', f, {
        burning: true,
        showShadow: false,
      });

      assert.equal(readyRes.inkPixels, 0, `${bModel.id} ready f${f} has INK`);
      assert.equal(readyRes.semitransparentPixels, 0, `${bModel.id} ready f${f} smoke/flag must be opaque`);
      assert.equal(burnRes.inkPixels, 0, `${bModel.id} burning f${f} has INK`);
      assert.equal(burnRes.semitransparentPixels, 0, `${bModel.id} burning f${f} fire/smoke must be opaque`);

      readyHashes.add(readyRes.buffer.hashFrame());
      burningHashes.add(burnRes.buffer.hashFrame());
    }

    assert.ok(readyHashes.size >= 2, `${bModel.id} must animate smoke/flags/hearth`);
    assert.ok(burningHashes.size >= 2, `${bModel.id} burning state must animate fire/smoke`);
    assert.notDeepEqual(
      Array.from(readyHashes),
      Array.from(burningHashes),
      `${bModel.id} burning state must differ visually from ready`
    );
  }
});

test('Stage 3: All 5 Pixel VFX (blood, dust, sparks, arrow, magic) have <=8 colors, 0 INK, 0 semitransparency & 4 frames', () => {
  const inkUpper = INK.toUpperCase();
  for (const id of PIXEL_VFX_IDS) {
    const spec = PIXEL_VFX_SPECS[id];
    assert.equal(spec.frameCount, 4);
    const frameHashes = new Set<string>();

    for (let f = 0; f < 4; f++) {
      const buf = renderVfxFrame(id, f, { k1Hex: '#EAB308' });
      const colors = new Set<string>();
      let inkCount = 0;
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          const px = buf.getPixel(x, y);
          if (!px) continue;
          colors.add(px);
          if (px === inkUpper) inkCount++;
        }
      }
      assert.equal(inkCount, 0, `VFX ${id} f${f} has INK pixel`);
      assert.equal(hasSemitransparentPixels(buf), 0, `VFX ${id} f${f} has semitransparency`);
      assert.ok(colors.size > 0 && colors.size <= 8, `VFX ${id} f${f} colors=${colors.size}`);
      frameHashes.add(buf.hashFrame());
    }
    assert.ok(frameHashes.size >= 2, `VFX ${id} must have distinct frames`);
  }
});

test('Stage 3: Atlas JSON manifests export animation clips (frames, frameDurationsMs, anchors, loop)', () => {
  const unitAtlas = bakeAnimatedUnitAtlas(
    42,
    { race: 'raptor-kin', era: 'dinosaurs', role: 'warrior', action: 'attack-melee', kingdomId: 1 },
    { scale: 1 }
  );
  const clipIds = Object.keys(unitAtlas.manifest.animations);
  assert.equal(clipIds.length, 1);
  const clip = unitAtlas.manifest.animations[clipIds[0]];
  assert.equal(clip.frames.length, 4);
  assert.equal(clip.frameDurationsMs.length, 4);
  assert.equal(clip.anchors.length, 4);
  assert.equal(clip.loop, true);
  assert.equal(clip.action, 'attack-melee');

  // Mixed atlas with creature + building + vfx clips
  const mixed = bakeAtlas([
    { kind: 'creature', species: 'dire-wolf', action: 'attack', frameIndex: 0, clipId: 'wolf_atk' },
    { kind: 'creature', species: 'dire-wolf', action: 'attack', frameIndex: 1, clipId: 'wolf_atk' },
    { kind: 'building', id: 'citadel-keep', burning: true, frameIndex: 0, clipId: 'keep_burn' },
    { kind: 'building', id: 'citadel-keep', burning: true, frameIndex: 1, clipId: 'keep_burn' },
    { kind: 'vfx', effectId: 'magic', frameIndex: 0, clipId: 'vfx_magic' },
    { kind: 'vfx', effectId: 'magic', frameIndex: 1, clipId: 'vfx_magic' },
  ]);
  assert.equal(mixed.manifest.animations.wolf_atk.frames.length, 2);
  assert.equal(mixed.manifest.animations.keep_burn.frames.length, 2);
  assert.equal(mixed.manifest.animations.vfx_magic.frames.length, 2);
  assert.equal(mixed.manifest.animations.vfx_magic.loop, false);

  // Procedural batch pack manifest animations map
  const batch = packProceduralAtlasBatch({
    count: 36,
    baseSeed: 8000,
    includeAllEras: true,
    includeAllRaces: true,
  });
  const batchClips = Object.values(batch.manifest.animations);
  assert.ok(batchClips.length > 0, 'packProceduralAtlasBatch must include manifest.animations clips');
  assert.ok(batchClips[0].frames.length > 0);
  assert.equal(batchClips[0].frames.length, batchClips[0].frameDurationsMs.length);
  assert.equal(batchClips[0].frames.length, batchClips[0].anchors.length);
  assert.equal(typeof batchClips[0].loop, 'boolean');
});

test('Stage 3: Village simulation runs 20 units + combat VFX and 10,000 animated units benchmark completes fast', () => {
  for (const race of ['human', 'marshfolk', 'raptor-kin', 'hive-mind'] as const) {
    const sim = createVillageSimulation(race, 1, false);
    assert.equal(sim.units.length, 20, `Village for ${race} must have 20 units`);
    assert.ok(sim.units.every((u) => u.race === race));

    const seenActions = new Set(sim.units.map((u) => u.action));
    assert.ok(seenActions.has('chop'));
    assert.ok(seenActions.has('mine'));
    assert.ok(seenActions.has('build'));
    assert.ok(seenActions.has('gather'));
    assert.ok(seenActions.has('fish'));
    assert.ok(seenActions.has('attack-melee'));
    assert.ok(seenActions.has('attack-ranged'));
    assert.ok(seenActions.has('cast'));

    const seenVfx = new Set<string>();
    for (let step = 0; step < 60; step++) {
      stepVillageSimulation(sim, 80);
      for (const v of sim.vfx) seenVfx.add(v.effectId);
    }
    assert.ok(sim.simTimeMs > 4000);
    assert.ok(seenVfx.has('dust'), `${race} village must emit footstep dust`);
    assert.ok(seenVfx.has('arrow'), `${race} village must emit flying arrows`);
    assert.ok(seenVfx.has('magic'), `${race} village must emit magic flashes`);
    assert.ok(seenVfx.has('sparks'), `${race} village must emit sparks`);
    assert.ok(seenVfx.has('blood'), `${race} village must emit blood splatter`);
  }

  const bench = benchmarkAnimatedUnits(10000);
  assert.equal(bench.unitCount, 10000);
  assert.ok(bench.uniqueSpriteCount >= 300);
  assert.ok(bench.tickRenderMs < 100, `10,000 unit tick+blit took too long: ${bench.tickRenderMs}ms`);
  assert.ok(bench.simulatedFps >= 15);
});
