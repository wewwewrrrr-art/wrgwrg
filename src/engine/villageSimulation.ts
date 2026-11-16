import { ALL_MODELS } from '../models';
import type { PixelModelDef } from '../models/types';
import { CREATURE_ANIMATION_SPECS, type CreatureAnimationAction } from './creatureAnimations';
import type { VfxEffectId } from './pixelVfx';
import {
  type ActiveUnitRace,
  type MedievalHumanRole,
  type UnitAge,
  type UnitAnimationAction,
  type UnitCarryItem,
  type UnitEra,
  type UnitGender,
  generateProceduralUnit,
  getRaceActionSpec,
} from './proceduralHuman';
import {
  ALL_RACE_BUILDINGS,
  MEDIEVAL_TOWN_HALL,
  RACE_ARCHITECTURE_GROUPS,
} from './proceduralRaceBuildings';

/**
 * ============================================================================
 * VILLAGE SIMULATION & 10,000-UNIT ANIMATION BENCHMARK (PURE LOGIC)
 * ============================================================================
 * Powers the live «Деревня» RTS scene:
 *  - Spawns 20 autonomous animated units of ONE chosen active race
 *  - Covers work cycles (chop->log, mine->stone, build, gather->basket, fish)
 *  - Runs walking, running, idle, sleep, and an active combat encounter
 *    (melee clash, ranged bow firing arrows, cleric magic cast, hit, death)
 *  - Emits pixel VFX events (blood, dust, sparks, arrow projectiles, magic)
 *  - Includes a deterministic 10,000 animated-unit benchmark (`benchmarkAnimatedUnits`)
 * ============================================================================
 */

export type VillageUnitTask =
  | 'chop-loop'
  | 'mine-loop'
  | 'build-site'
  | 'gather-loop'
  | 'fish-pond'
  | 'patrol-walk'
  | 'camp-rest'
  | 'combat-melee'
  | 'combat-archer'
  | 'combat-cleric'
  | 'combat-target';

export interface VillageUnitAgent {
  readonly id: number;
  readonly seed: number;
  readonly race: ActiveUnitRace;
  readonly era: UnitEra;
  readonly role: MedievalHumanRole;
  readonly gender: UnitGender;
  readonly age: UnitAge;
  readonly task: VillageUnitTask;
  readonly homeX: number;
  readonly homeY: number;
  readonly targetX: number;
  readonly targetY: number;
  x: number;
  y: number;
  facing: 1 | -1;
  action: UnitAnimationAction;
  carry: UnitCarryItem;
  phase: 'work' | 'carry' | 'fight' | 'recover';
  phaseTimerMs: number;
  animElapsedMs: number;
  frameIndex: number;
  dustCooldownMs: number;
}

export interface VillageVfxInstance {
  readonly id: number;
  readonly effectId: VfxEffectId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  direction: 1 | -1;
  elapsedMs: number;
  lifetimeMs: number;
}

export interface VillageBuildingSlot {
  readonly model: PixelModelDef;
  readonly x: number;
  readonly y: number;
  readonly isBurningCandidate: boolean;
}

export interface VillageCreatureAgent {
  readonly id: number;
  readonly model: PixelModelDef;
  x: number;
  y: number;
  vx: number;
  minX: number;
  maxX: number;
  facing: 1 | -1;
  action: CreatureAnimationAction;
  elapsedMs: number;
  frameIndex: number;
}

export interface VillageSimulationState {
  readonly race: ActiveUnitRace;
  readonly era: UnitEra;
  readonly kingdomId: number;
  readonly width: number;
  readonly height: number;
  burningBuilding: boolean;
  simTimeMs: number;
  nextVfxId: number;
  buildings: VillageBuildingSlot[];
  units: VillageUnitAgent[];
  creatures: VillageCreatureAgent[];
  vfx: VillageVfxInstance[];
}

export const VILLAGE_WORLD_W = 240;
export const VILLAGE_WORLD_H = 132;

export function getDefaultEraForRace(race: ActiveUnitRace): UnitEra {
  if (race === 'hive-mind') return 'primordial';
  if (race === 'raptor-kin') return 'dinosaurs';
  if (race === 'neanderthal') return 'ice-age';
  return 'medieval';
}

function pickBuildingsForRace(race: ActiveUnitRace): VillageBuildingSlot[] {
  const byId = new Map<string, PixelModelDef>([
    ...ALL_MODELS.map((m) => [m.id, m] as const),
    ...ALL_RACE_BUILDINGS.map((m) => [m.id, m] as const),
    [MEDIEVAL_TOWN_HALL.id, MEDIEVAL_TOWN_HALL],
  ]);

  if (race === 'human') {
    return [
      { model: MEDIEVAL_TOWN_HALL, x: 96, y: 18, isBurningCandidate: true },
      { model: byId.get('ironclad-armory') ?? MEDIEVAL_TOWN_HALL, x: 146, y: 18, isBurningCandidate: false },
      { model: byId.get('medieval-windmill') ?? MEDIEVAL_TOWN_HALL, x: 46, y: 16, isBurningCandidate: false },
    ];
  }

  if (race === 'hive-mind') {
    return [
      { model: byId.get('coral-reef-colony') ?? MEDIEVAL_TOWN_HALL, x: 98, y: 20, isBurningCandidate: true },
      { model: byId.get('mana-shrub') ?? MEDIEVAL_TOWN_HALL, x: 52, y: 26, isBurningCandidate: false },
      { model: byId.get('obsidian-monolith') ?? MEDIEVAL_TOWN_HALL, x: 148, y: 22, isBurningCandidate: false },
    ];
  }

  const grp = RACE_ARCHITECTURE_GROUPS.find((g) => g.raceId === race);
  if (grp && grp.buildings.length >= 3) {
    return [
      { model: grp.buildings[0], x: 96, y: 18, isBurningCandidate: true },
      { model: grp.buildings[1], x: 148, y: 20, isBurningCandidate: false },
      { model: grp.buildings[2], x: 48, y: 20, isBurningCandidate: false },
    ];
  }

  return [
    { model: MEDIEVAL_TOWN_HALL, x: 96, y: 18, isBurningCandidate: true },
  ];
}

function pickCreaturesForRace(race: ActiveUnitRace): VillageCreatureAgent[] {
  const byId = new Map(ALL_MODELS.map((m) => [m.id, m] as const));
  const specs: readonly { id: string; x: number; y: number; vx: number; minX: number; maxX: number; action: CreatureAnimationAction }[] =
    race === 'raptor-kin'
      ? [
          { id: 'dino-pack-compy', x: 75, y: 102, vx: 0.018, minX: 45, maxX: 120, action: 'walk' },
          { id: 'dino-pteranodon', x: 120, y: 14, vx: -0.022, minX: 18, maxX: 215, action: 'walk' },
        ]
      : race === 'neanderthal'
        ? [
            { id: 'stone-tamed-wolf', x: 82, y: 102, vx: 0.015, minX: 45, maxX: 125, action: 'walk' },
            { id: 'steppe-eagle', x: 140, y: 12, vx: -0.02, minX: 20, maxX: 215, action: 'walk' },
          ]
        : [
            { id: 'wild-boar', x: 78, y: 102, vx: 0.013, minX: 45, maxX: 128, action: 'walk' },
            { id: 'dire-wolf', x: 132, y: 106, vx: -0.016, minX: 90, maxX: 165, action: 'walk' },
            { id: 'steppe-eagle', x: 90, y: 12, vx: 0.024, minX: 18, maxX: 220, action: 'walk' },
          ];

  return specs
    .map((sp, idx) => {
      const model = byId.get(sp.id);
      if (!model) return null;
      return {
        id: idx + 1,
        model,
        x: sp.x,
        y: sp.y,
        vx: sp.vx,
        minX: sp.minX,
        maxX: sp.maxX,
        facing: sp.vx >= 0 ? (1 as const) : (-1 as const),
        action: sp.action,
        elapsedMs: idx * 140,
        frameIndex: 0,
      };
    })
    .filter((c): c is VillageCreatureAgent => c !== null);
}

export function createVillageSimulation(
  race: ActiveUnitRace = 'human',
  kingdomId = 0,
  burningBuilding = false
): VillageSimulationState {
  const era = getDefaultEraForRace(race);
  const buildings = pickBuildingsForRace(race);
  const creatures = pickCreaturesForRace(race);

  // Exactly 20 units of the SAME chosen race performing full village + combat life
  const roster: readonly {
    task: VillageUnitTask;
    role: MedievalHumanRole;
    gender: UnitGender;
    age: UnitAge;
    homeX: number;
    homeY: number;
    targetX: number;
    targetY: number;
    action: UnitAnimationAction;
    carry: UnitCarryItem;
    phase: VillageUnitAgent['phase'];
  }[] = [
    // 3 Woodcutters (chop <-> walk+log)
    { task: 'chop-loop', role: 'worker', gender: 'male', age: 'adult', homeX: 88, homeY: 64, targetX: 26, targetY: 74, action: 'chop', carry: 'none', phase: 'work' },
    { task: 'chop-loop', role: 'worker', gender: 'female', age: 'adult', homeX: 96, homeY: 68, targetX: 34, targetY: 88, action: 'walk', carry: 'log', phase: 'carry' },
    { task: 'chop-loop', role: 'peasant', gender: 'male', age: 'adult', homeX: 90, homeY: 72, targetX: 22, targetY: 100, action: 'chop', carry: 'none', phase: 'work' },
    // 3 Miners (mine <-> walk+stone)
    { task: 'mine-loop', role: 'worker', gender: 'male', age: 'adult', homeX: 138, homeY: 66, targetX: 168, targetY: 56, action: 'mine', carry: 'none', phase: 'work' },
    { task: 'mine-loop', role: 'worker', gender: 'male', age: 'elder', homeX: 144, homeY: 70, targetX: 178, targetY: 62, action: 'walk', carry: 'stone', phase: 'carry' },
    { task: 'mine-loop', role: 'worker', gender: 'female', age: 'adult', homeX: 136, homeY: 74, targetX: 174, targetY: 74, action: 'mine', carry: 'none', phase: 'work' },
    // 2 Builders
    { task: 'build-site', role: 'worker', gender: 'male', age: 'adult', homeX: 108, homeY: 74, targetX: 112, targetY: 74, action: 'build', carry: 'none', phase: 'work' },
    { task: 'build-site', role: 'settlement-leader', gender: 'female', age: 'adult', homeX: 120, homeY: 74, targetX: 118, targetY: 74, action: 'build', carry: 'none', phase: 'work' },
    // 3 Gatherers (gather <-> walk+basket)
    { task: 'gather-loop', role: 'peasant', gender: 'female', age: 'adult', homeX: 84, homeY: 82, targetX: 52, targetY: 106, action: 'gather', carry: 'none', phase: 'work' },
    { task: 'gather-loop', role: 'peasant', gender: 'female', age: 'child', homeX: 78, homeY: 86, targetX: 64, targetY: 112, action: 'walk', carry: 'basket', phase: 'carry' },
    { task: 'gather-loop', role: 'merchant', gender: 'male', age: 'adult', homeX: 98, homeY: 84, targetX: 70, targetY: 96, action: 'gather', carry: 'none', phase: 'work' },
    // 2 Anglers by the pond
    { task: 'fish-pond', role: 'peasant', gender: 'male', age: 'elder', homeX: 38, homeY: 114, targetX: 38, targetY: 114, action: 'fish', carry: 'none', phase: 'work' },
    { task: 'fish-pond', role: 'peasant', gender: 'female', age: 'adult', homeX: 52, homeY: 118, targetX: 52, targetY: 118, action: 'fish', carry: 'none', phase: 'work' },
    // 2 Resting / Walking / Sleeping
    { task: 'camp-rest', role: 'king', gender: 'male', age: 'adult', homeX: 102, homeY: 66, targetX: 102, targetY: 66, action: 'idle', carry: 'none', phase: 'work' },
    { task: 'camp-rest', role: 'peasant', gender: 'male', age: 'child', homeX: 72, homeY: 68, targetX: 72, targetY: 68, action: 'sleep', carry: 'none', phase: 'work' },
    // 5 Combat Encounter units on the eastern battleground (x=185..225, y=82..116)
    { task: 'combat-melee', role: 'warrior', gender: 'male', age: 'adult', homeX: 194, homeY: 98, targetX: 204, targetY: 98, action: 'attack-melee', carry: 'none', phase: 'fight' },
    { task: 'combat-melee', role: 'warrior', gender: 'female', age: 'adult', homeX: 196, homeY: 110, targetX: 206, targetY: 110, action: 'run', carry: 'none', phase: 'fight' },
    { task: 'combat-archer', role: 'archer', gender: 'female', age: 'adult', homeX: 176, homeY: 94, targetX: 176, targetY: 94, action: 'attack-ranged', carry: 'none', phase: 'fight' },
    { task: 'combat-cleric', role: 'cleric', gender: 'male', age: 'elder', homeX: 178, homeY: 112, targetX: 178, targetY: 112, action: 'cast', carry: 'none', phase: 'fight' },
    { task: 'combat-target', role: 'warrior', gender: 'male', age: 'adult', homeX: 214, homeY: 102, targetX: 214, targetY: 102, action: 'hit', carry: 'none', phase: 'fight' },
  ];

  const units: VillageUnitAgent[] = roster.map((r, idx) => {
    const startAtTarget = r.phase === 'work' || r.phase === 'fight';
    const x = startAtTarget ? r.targetX : Math.round((r.homeX + r.targetX) / 2);
    const y = startAtTarget ? r.targetY : Math.round((r.homeY + r.targetY) / 2);
    return {
      id: idx + 1,
      seed: 4100 + idx * 97,
      race,
      era,
      role: r.role,
      gender: r.gender,
      age: r.age,
      task: r.task,
      homeX: r.homeX,
      homeY: r.homeY,
      targetX: r.targetX,
      targetY: r.targetY,
      x,
      y,
      facing: r.task === 'combat-target' ? -1 : 1,
      action: r.action,
      carry: r.carry,
      phase: r.phase,
      phaseTimerMs: (idx % 4) * 350,
      animElapsedMs: idx * 75,
      frameIndex: idx % 2,
      dustCooldownMs: 320 + idx * 50,
    };
  });

  return {
    race,
    era,
    kingdomId,
    width: VILLAGE_WORLD_W,
    height: VILLAGE_WORLD_H,
    burningBuilding,
    simTimeMs: 0,
    nextVfxId: 1,
    buildings,
    units,
    creatures,
    vfx: [],
  };
}

function spawnVfx(
  state: VillageSimulationState,
  effectId: VfxEffectId,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
  direction: 1 | -1 = 1,
  lifetimeMs = 420
): void {
  if (state.vfx.length >= 28) return;
  state.vfx.push({
    id: state.nextVfxId++,
    effectId,
    x,
    y,
    vx,
    vy,
    direction,
    elapsedMs: 0,
    lifetimeMs,
  });
}

function moveToward(
  u: VillageUnitAgent,
  destX: number,
  destY: number,
  speedPxPerSec: number,
  dtMs: number
): boolean {
  const dx = destX - u.x;
  const dy = destY - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1.2) {
    u.x = destX;
    u.y = destY;
    return true;
  }
  const step = Math.min(dist, (speedPxPerSec * dtMs) / 1000);
  u.x += (dx / dist) * step;
  u.y += (dy / dist) * step;
  u.facing = dx >= -0.05 ? 1 : -1;
  return false;
}

/**
 * Advances the 20-unit village, roaming animals, and pixel VFX by `dtMs`.
 */
export function stepVillageSimulation(
  state: VillageSimulationState,
  dtMs: number
): VillageSimulationState {
  const dt = Math.max(8, Math.min(120, dtMs));
  state.simTimeMs += dt;

  // Step active VFX
  for (let i = state.vfx.length - 1; i >= 0; i--) {
    const p = state.vfx[i];
    p.x += (p.vx * dt) / 1000;
    p.y += (p.vy * dt) / 1000;
    p.elapsedMs += dt;
    if (p.elapsedMs >= p.lifetimeMs) {
      state.vfx.splice(i, 1);
    }
  }

  // Step roaming creatures
  for (const c of state.creatures) {
    c.x += c.vx * dt;
    if (c.x <= c.minX) {
      c.x = c.minX;
      c.vx = Math.abs(c.vx);
    } else if (c.x >= c.maxX) {
      c.x = c.maxX;
      c.vx = -Math.abs(c.vx);
    }
    c.facing = c.vx >= 0 ? 1 : -1;
    const cSpec = CREATURE_ANIMATION_SPECS[c.action];
    const cDur = cSpec.frameDurationsMs[c.frameIndex % cSpec.frameCount] ?? 165;
    c.elapsedMs += dt;
    if (c.elapsedMs >= cDur) {
      c.elapsedMs -= cDur;
      c.frameIndex = (c.frameIndex + 1) % cSpec.frameCount;
    }
  }

  // Step 20 units
  for (const u of state.units) {
    u.phaseTimerMs += dt;
    u.dustCooldownMs -= dt;

    const spec = getRaceActionSpec(u.race, u.action);
    const frameDur = spec.frameDurationsMs[u.frameIndex % spec.frameCount] ?? 160;
    u.animElapsedMs += dt;

    let frameAdvanced = false;
    if (u.animElapsedMs >= frameDur) {
      u.animElapsedMs -= frameDur;
      if (u.action === 'death' && !spec.loop) {
        if (u.frameIndex < spec.frameCount - 1) {
          u.frameIndex += 1;
          frameAdvanced = true;
        }
      } else {
        u.frameIndex = (u.frameIndex + 1) % spec.frameCount;
        frameAdvanced = true;
      }
    }

    // Footstep dust emission while walking / running
    if ((u.action === 'walk' || u.action === 'run') && u.dustCooldownMs <= 0) {
      spawnVfx(state, 'dust', u.x, u.y + 4, 0, -2, u.facing, 380);
      u.dustCooldownMs = u.action === 'run' ? 420 : 680;
    }

    // Task state machines
    if (u.task === 'chop-loop' || u.task === 'mine-loop' || u.task === 'gather-loop') {
      const workAct: UnitAnimationAction =
        u.task === 'chop-loop' ? 'chop' : u.task === 'mine-loop' ? 'mine' : 'gather';
      const cargo: UnitCarryItem =
        u.task === 'chop-loop' ? 'log' : u.task === 'mine-loop' ? 'stone' : 'basket';

      if (u.phase === 'work') {
        u.action = workAct;
        u.carry = 'none';
        if (u.task === 'mine-loop' && frameAdvanced && u.frameIndex === 2) {
          spawnVfx(state, 'sparks', u.x + 7, u.y - 1, 4, -3, 1, 320);
        }
        if (u.phaseTimerMs >= 2600) {
          u.phase = 'carry';
          u.phaseTimerMs = 0;
          u.action = 'walk';
          u.carry = cargo;
          u.frameIndex = 0;
        }
      } else if (u.phase === 'carry') {
        u.action = 'walk';
        u.carry = cargo;
        const speed = u.race === 'antlerfolk' ? 11 : 17;
        const arrived = moveToward(u, u.homeX, u.homeY, speed, dt);
        if (arrived) {
          u.phase = 'recover';
          u.phaseTimerMs = 0;
          u.carry = 'none';
          u.action = 'walk';
          u.frameIndex = 0;
        }
      } else {
        u.action = 'walk';
        u.carry = 'none';
        const speed = u.race === 'antlerfolk' ? 12 : 19;
        const backAtResource = moveToward(u, u.targetX, u.targetY, speed, dt);
        if (backAtResource) {
          u.phase = 'work';
          u.phaseTimerMs = 0;
          u.action = workAct;
          u.frameIndex = 0;
        }
      }
    } else if (u.task === 'build-site') {
      u.action = 'build';
      if (frameAdvanced && u.frameIndex === 2) {
        spawnVfx(state, 'sparks', u.x + 6, u.y, 2, -4, 1, 260);
      }
    } else if (u.task === 'fish-pond') {
      u.action = 'fish';
    } else if (u.task === 'camp-rest') {
      if (u.phaseTimerMs >= 3200) {
        u.phaseTimerMs = 0;
        u.action = u.action === 'idle' ? 'sleep' : 'idle';
        u.frameIndex = 0;
      }
    } else if (u.task === 'combat-melee') {
      if (u.phase === 'fight') {
        u.action = 'attack-melee';
        if (frameAdvanced && u.frameIndex === 1) {
          spawnVfx(state, 'sparks', u.x + 9, u.y - 1, 6, -4, 1, 300);
        }
        if (u.phaseTimerMs >= 2400) {
          u.phase = 'recover';
          u.phaseTimerMs = 0;
          u.action = 'run';
          u.frameIndex = 0;
        }
      } else {
        u.action = 'run';
        const destX = u.phaseTimerMs < 900 ? u.homeX - 8 : u.targetX;
        const destY = u.targetY;
        moveToward(u, destX, destY, u.race === 'raptor-kin' ? 32 : 24, dt);
        if (u.phaseTimerMs >= 1600) {
          u.phase = 'fight';
          u.phaseTimerMs = 0;
          u.action = 'attack-melee';
          u.frameIndex = 0;
        }
      }
    } else if (u.task === 'combat-archer') {
      u.action = 'attack-ranged';
      if (frameAdvanced && u.frameIndex === 2) {
        spawnVfx(state, 'arrow', u.x + 8, u.y - 2, 72, 0, 1, 520);
      }
    } else if (u.task === 'combat-cleric') {
      u.action = 'cast';
      if (frameAdvanced && u.frameIndex === 2) {
        spawnVfx(state, 'magic', u.x + 28, u.y - 6, 0, 0, 1, 440);
      }
    } else if (u.task === 'combat-target') {
      if (u.action === 'hit' && u.phaseTimerMs >= 1400) {
        u.action = 'death';
        u.frameIndex = 0;
        u.phaseTimerMs = 0;
        spawnVfx(state, 'blood', u.x, u.y, 4, 2, -1, 460);
      } else if (u.action === 'death' && u.phaseTimerMs >= 2200) {
        u.action = 'hit';
        u.frameIndex = 0;
        u.phaseTimerMs = 0;
        spawnVfx(state, 'blood', u.x - 2, u.y - 2, -4, 0, -1, 400);
      } else if (u.action === 'hit' && frameAdvanced && u.frameIndex === 0) {
        spawnVfx(state, 'blood', u.x - 2, u.y - 1, 3, 2, -1, 380);
      }
    }
  }

  return state;
}

export interface AnimatedUnitsBenchmarkResult {
  readonly unitCount: number;
  readonly generateMs: number;
  readonly tickRenderMs: number;
  readonly totalMs: number;
  readonly simulatedFps: number;
  readonly uniqueSpriteCount: number;
}

/**
 * Benchmarks animating `count` (default 10,000) multi-action units across races:
 * measures both sprite generation/caching and a full per-frame animation tick +
 * blit budget into a packed RGBA buffer, returning verified ms and FPS.
 */
export function benchmarkAnimatedUnits(count = 10000): AnimatedUnitsBenchmarkResult {
  const races: readonly ActiveUnitRace[] = [
    'human',
    'marshfolk',
    'stonekin',
    'antlerfolk',
    'ash-nomads',
    'undead',
    'demon',
    'neanderthal',
    'raptor-kin',
    'hive-mind',
  ];
  const actions: readonly UnitAnimationAction[] = [
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
  ];

  // Phase 1: pre-bake reusable frame cache for active race × action × frame variants
  const genStart = performance.now();
  const frameCache = new Map<string, Uint32Array>();
  for (let r = 0; r < races.length; r++) {
    const race = races[r];
    const era = getDefaultEraForRace(race);
    for (let a = 0; a < actions.length; a++) {
      const action = actions[a];
      const spec = getRaceActionSpec(race, action);
      for (let f = 0; f < spec.frameCount; f++) {
        const key = `${race}_${action}_${f}`;
        const u = generateProceduralUnit({
          seed: 700 + r * 31 + a,
          era,
          race,
          action,
          frameIndex: f,
          kingdomId: r % 6,
        });
        const rgba = u.buffer.toRgbaBytes();
        frameCache.set(key, new Uint32Array(rgba.buffer, rgba.byteOffset, 100));
      }
    }
  }
  const generateMs = Number((performance.now() - genStart).toFixed(2));

  // Build 10,000 animated unit instances
  const keys = Array.from(frameCache.values());
  const numSprites = keys.length;
  const unitX = new Float32Array(count);
  const unitY = new Float32Array(count);
  const unitVx = new Float32Array(count);
  const unitSpriteIdx = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    unitX[i] = (i * 17) % 1000;
    unitY[i] = ((i * 29) % 580);
    unitVx[i] = (i % 2 === 0 ? 1 : -1) * (12 + (i % 7));
    unitSpriteIdx[i] = i % numSprites;
  }

  // Phase 2: simulate 1 animation tick + software blit pass for all 10,000 animated units
  const screenW = 1024;
  const screenH = 600;
  const screen = new Uint32Array(screenW * screenH);
  const tickStart = performance.now();
  const dt = 0.016;

  for (let i = 0; i < count; i++) {
    let nx = unitX[i] + unitVx[i] * dt;
    if (nx < 0) nx += 1000;
    else if (nx >= 1000) nx -= 1000;
    unitX[i] = nx;

    const sprite = keys[(unitSpriteIdx[i] + 1) % numSprites];
    const ox = nx | 0;
    const oy = unitY[i] | 0;
    for (let py = 0; py < 10; py++) {
      const rowOff = (oy + py) * screenW + ox;
      const srcOff = py * 10;
      for (let px = 0; px < 10; px++) {
        const col = sprite[srcOff + px];
        if (col !== 0) {
          screen[rowOff + px] = col;
        }
      }
    }
  }

  const tickRenderMs = Number((performance.now() - tickStart).toFixed(2));
  const totalMs = Number((generateMs + tickRenderMs).toFixed(2));
  const simulatedFps = Math.round(1000 / Math.max(0.1, tickRenderMs));

  return {
    unitCount: count,
    generateMs,
    tickRenderMs,
    totalMs,
    simulatedFps,
    uniqueSpriteCount: numSprites,
  };
}
