import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIEVAL_ROLE_LABELS,
  MedievalHumanRole,
  UNIT_ANIMATION_ACTIONS,
  UNIT_CARRY_ITEMS,
  UNIT_STATUS_LABELS,
  UnitAge,
  UnitAnimationAction,
  UnitGender,
  UnitStatus,
  generateProceduralUnit,
  getUnitActionSpec,
} from './proceduralHuman';

test('Medieval human animations: all 14 actions match required frame counts & timing metadata', () => {
  const expectedCounts: Record<UnitAnimationAction, number> = {
    walk: 4,
    run: 4,
    idle: 2,
    chop: 4,
    mine: 4,
    build: 4,
    gather: 4,
    fish: 4,
    'attack-melee': 4,
    'attack-ranged': 4,
    cast: 4,
    hit: 2,
    death: 4,
    sleep: 2,
  };

  assert.equal(UNIT_ANIMATION_ACTIONS.length, 14);
  for (const action of UNIT_ANIMATION_ACTIONS) {
    const spec = getUnitActionSpec(action);
    assert.equal(spec.frameCount, expectedCounts[action], `Frame count mismatch for ${action}`);
    assert.equal(spec.frameDurationsMs.length, spec.frameCount);
    for (const ms of spec.frameDurationsMs) {
      assert.ok(ms >= 60 && ms <= 1000, `Duration out of range for ${action}: ${ms}`);
    }
  }
  assert.equal(getUnitActionSpec('death').loop, false);
  assert.equal(getUnitActionSpec('hit').loop, false);
  assert.equal(getUnitActionSpec('walk').loop, true);
});

test('Medieval human animations: strict <=8 colors, 0 orphans, 0 INK, 0 semitransparent, grounded feetY=9 across roles, ages, genders, statuses & carry items', () => {
  const roles = Object.keys(MEDIEVAL_ROLE_LABELS) as MedievalHumanRole[];
  const ages: UnitAge[] = ['child', 'adult', 'elder'];
  const genders: UnitGender[] = ['male', 'female'];
  const statuses = Object.keys(UNIT_STATUS_LABELS) as UnitStatus[];

  let checked = 0;

  // Sweep all 14 actions across all 11 roles, 2 genders, 3 ages
  for (const action of UNIT_ANIMATION_ACTIONS) {
    const spec = getUnitActionSpec(action);
    for (const role of roles) {
      for (const age of ages) {
        const gender: UnitGender =
          role === 'queen' ? 'female' : role === 'king' ? 'male' : genders[checked % 2];
        const status: UnitStatus = statuses[checked % statuses.length];
        for (let frameIndex = 0; frameIndex < spec.frameCount; frameIndex++) {
          const res = generateProceduralUnit({
            seed: 9100 + checked,
            era: 'medieval',
            race: 'human',
            role,
            age,
            gender,
            status,
            kingdomId: checked % 84,
            skinId: checked % 14,
            hairId: checked % 12,
            action,
            carry: 'none',
            frameIndex,
          });
          checked++;

          assert.ok(
            res.audit.uniqueColors <= 8,
            `${action} f${frameIndex} (${role}/${age}/${gender}/${status}) used ${res.audit.uniqueColors} colors (>8)`
          );
          assert.equal(
            res.audit.semitransparentPixels,
            0,
            `${action} f${frameIndex} (${role}/${age}/${status}) had semitransparent pixels`
          );
          assert.equal(
            res.audit.inkPixels,
            0,
            `${action} f${frameIndex} (${role}/${age}/${status}) had #131110 INK pixels`
          );
          assert.equal(
            res.audit.orphanPixels,
            0,
            `${action} f${frameIndex} (${role}/${age}/${gender}/${status}) had ${res.audit.orphanPixels} orphan pixel(s)`
          );

          // Grounded on feetY = 9 on every frame
          assert.equal(res.profile.anchors.feetY, 9);
          let hasGroundPixel = false;
          for (let x = 0; x < 10; x++) {
            if (res.buffer.getPixel(x, 9) !== null) {
              hasGroundPixel = true;
              break;
            }
          }
          assert.ok(
            hasGroundPixel,
            `${action} f${frameIndex} (${role}/${age}/${gender}/${status}) must stay grounded at y=9`
          );
        }
      }
    }
  }

  // Sweep all 3 carry items + none over 4-frame walk across roles & ages
  for (const carryItem of UNIT_CARRY_ITEMS) {
    for (const role of roles) {
      for (const age of ages) {
        for (let frameIndex = 0; frameIndex < 4; frameIndex++) {
          const res = generateProceduralUnit({
            seed: 12000 + checked,
            era: 'medieval',
            race: 'human',
            role,
            age,
            gender: role === 'queen' ? 'female' : 'male',
            status: 'healthy',
            kingdomId: checked % 84,
            action: 'walk',
            carry: carryItem.id,
            frameIndex,
          });
          checked++;
          assert.ok(res.audit.uniqueColors <= 8);
          assert.equal(res.audit.semitransparentPixels, 0);
          assert.equal(res.audit.inkPixels, 0);
          assert.equal(
            res.audit.orphanPixels,
            0,
            `walk+carry(${carryItem.id}) f${frameIndex} (${role}/${age}) had ${res.audit.orphanPixels} orphan pixel(s)`
          );
        }
      }
    }
  }

  assert.ok(checked > 1500);
});

test('Medieval human animations: frames animate distinctly, death collapses to corpse, sleep lies breathing, and carry modifies walk', () => {
  for (const action of UNIT_ANIMATION_ACTIONS) {
    const spec = getUnitActionSpec(action);
    const hashes = new Set<string>();
    const role: MedievalHumanRole =
      action === 'attack-ranged'
        ? 'archer'
        : action === 'cast'
          ? 'cleric'
          : action === 'chop' || action === 'mine' || action === 'build'
            ? 'worker'
            : 'warrior';

    for (let f = 0; f < spec.frameCount; f++) {
      const res = generateProceduralUnit({
        seed: 1042,
        era: 'medieval',
        race: 'human',
        gender: 'male',
        age: 'adult',
        role,
        kingdomId: 0,
        status: 'healthy',
        action,
        frameIndex: f,
      });
      hashes.add(res.buffer.hashFrame());
    }
    assert.ok(
      hashes.size >= 2,
      `Action ${action} must produce distinct animated frames, got only ${hashes.size}`
    );
  }

  // Death progression: upright on f0 -> flat corpse (height <= 4px) on f3
  const d0 = generateProceduralUnit({
    seed: 1042,
    era: 'medieval',
    race: 'human',
    role: 'warrior',
    action: 'death',
    frameIndex: 0,
  });
  const d3 = generateProceduralUnit({
    seed: 1042,
    era: 'medieval',
    race: 'human',
    role: 'warrior',
    action: 'death',
    frameIndex: 3,
  });
  assert.ok(d0.audit.boundingBox.height >= 8, `Death f0 should start upright, got h=${d0.audit.boundingBox.height}`);
  assert.ok(d3.audit.boundingBox.height <= 4, `Death f3 should lie flat as corpse, got h=${d3.audit.boundingBox.height}`);

  // Sleep stays flat (height <= 5px including breath puff) & differs f0 vs f1
  const s0 = generateProceduralUnit({
    seed: 1042,
    era: 'medieval',
    race: 'human',
    role: 'peasant',
    action: 'sleep',
    frameIndex: 0,
  });
  const s1 = generateProceduralUnit({
    seed: 1042,
    era: 'medieval',
    race: 'human',
    role: 'peasant',
    action: 'sleep',
    frameIndex: 1,
  });
  assert.ok(s0.audit.boundingBox.height <= 4);
  assert.ok(s1.audit.boundingBox.height <= 5);
  assert.notEqual(s0.buffer.hashFrame(), s1.buffer.hashFrame());

  // Carry overlays over walk produce distinct silhouettes from unarmed walk
  const walkEmpty = generateProceduralUnit({
    seed: 1042,
    era: 'medieval',
    race: 'human',
    role: 'worker',
    action: 'walk',
    carry: 'none',
    frameIndex: 0,
  });
  const carryHashes = new Set<string>([walkEmpty.buffer.hashFrame()]);
  for (const item of UNIT_CARRY_ITEMS) {
    if (item.id === 'none') continue;
    const carried = generateProceduralUnit({
      seed: 1042,
      era: 'medieval',
      race: 'human',
      role: 'worker',
      action: 'walk',
      carry: item.id,
      frameIndex: 0,
    });
    carryHashes.add(carried.buffer.hashFrame());
  }
  assert.equal(carryHashes.size, 4, 'walk + none/log/stone/basket must all differ visually');
});

test('Medieval human animations: weapons and tools track dynamic hand anchor across every frame', () => {
  const handTrackedActions: { action: UnitAnimationAction; role: MedievalHumanRole }[] = [
    { action: 'walk', role: 'warrior' },
    { action: 'run', role: 'warrior' },
    { action: 'idle', role: 'warrior' },
    { action: 'chop', role: 'worker' },
    { action: 'mine', role: 'worker' },
    { action: 'build', role: 'worker' },
    { action: 'fish', role: 'peasant' },
    { action: 'attack-melee', role: 'warrior' },
    { action: 'cast', role: 'cleric' },
  ];

  for (const { action, role } of handTrackedActions) {
    const spec = getUnitActionSpec(action);
    for (let f = 0; f < spec.frameCount; f++) {
      const res = generateProceduralUnit({
        seed: 2025,
        era: 'medieval',
        race: 'human',
        gender: 'male',
        age: 'adult',
        role,
        status: 'healthy',
        action,
        frameIndex: f,
      });
      const { rightX, rightY } = res.profile.anchors.hand;
      let hasToolNearHand = false;
      for (let dy = -1; dy <= 1 && !hasToolNearHand; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = rightX + dx;
          const y = rightY + dy;
          if (x < 0 || x >= 10 || y < 0 || y >= 10) continue;
          const z = res.zoneMap[y * 10 + x];
          if (z === 'metal' || z === 'wood' || z === 'gold' || z === 'status' || z === 'cloth') {
            hasToolNearHand = true;
            break;
          }
        }
      }
      assert.ok(
        hasToolNearHand,
        `${action} f${f} (${role}) tool/weapon must touch hand anchor (${rightX},${rightY})`
      );
    }
  }
});
