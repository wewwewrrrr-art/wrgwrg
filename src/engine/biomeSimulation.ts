import {
  BIOME_HEIGHT,
  BIOME_WIDTH,
  BiomeDefinition,
  BiomeLayer,
  BiomePlacement,
  GRID_COLS,
  GRID_ROWS,
  SteppedEntity,
  TILE_SIZE,
  TopDownTileType,
  buildBiomeTileGrid,
  renderBiomeBackdropFromGrid,
  stepBiomePlacement,
} from '../models/biomes';
import { PixelModelDef } from '../models/types';
import { PixelBuffer } from './pixelCanvas';

export interface BiomeSimEntity {
  id: string;
  placement: BiomePlacement;
  model: PixelModelDef;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  drawX: number;
  drawY: number;
  facing: -1 | 1;
  vx: number;
  vy: number;
  hitTimer: number;
  deadTimer: number | null;
  destroyed: boolean;
  userSpawned?: boolean;
}

export interface SimParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface SimDamagePopup {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
}

export interface BiomeWorldState {
  biomeId: BiomeDefinition['id'];
  tileMap: TopDownTileType[];
  crackMap: Uint8Array;
  rubbleMap: Uint8Array;
  clearedFloraMask: Uint8Array;
  entities: BiomeSimEntity[];
  particles: SimParticle[];
  popups: SimDamagePopup[];
  backdropDirty: boolean;
  shakeTimer: number;
  shakeIntensity: number;
  effectTickAccum: number;
  nextEntityUid: number;
  quakeCount: number;
  destroyedStructures: number;
  creaturesSlain: number;
  totalDamageDealt: number;
}

const FLYING_MODEL_IDS = new Set(['elder-dragon', 'bone-wyvern', 'plague-griffon']);
const TORNADO_POWER: Record<string, { radius: number; dmg: number; pull: number; scoursTiles: boolean }> = {
  'vfx-dust-devil': { radius: 20, dmg: 8, pull: 18, scoursTiles: false },
  'vfx-tornado': { radius: 30, dmg: 18, pull: 34, scoursTiles: true },
  'vfx-mega-tornado': { radius: 42, dmg: 36, pull: 54, scoursTiles: true },
  'vfx-firestorm': { radius: 24, dmg: 16, pull: 14, scoursTiles: true },
};

export function getInitialEntityHp(model: PixelModelDef): number {
  if (model.kind === 'weather') return 999999;
  if (model.kind === 'static' || model.kind === 'animated') return model.tier === 'III' ? 140 : 100;
  if (model.kind === 'nature') return 40;
  if (model.kind === 'substance') return 150;
  if (model.kind === 'aquatic') return model.tier === 'III' ? 180 : 130;
  return model.tier === 'III' ? 210 : model.tier === 'II' ? 120 : 85;
}

export function createBiomeSimState(
  biome: BiomeDefinition,
  modelById: Map<string, PixelModelDef>
): BiomeWorldState {
  const tileMap = buildBiomeTileGrid(biome.id);
  const gridLen = GRID_COLS * GRID_ROWS;
  const entities: BiomeSimEntity[] = [];

  for (const pl of biome.placements) {
    const model = modelById.get(pl.modelId);
    if (!model) continue;
    const maxHp = getInitialEntityHp(model);
    const stepped = stepBiomePlacement(pl, model, 0);
    entities.push({
      id: pl.id,
      placement: { ...pl },
      model,
      hp: maxHp,
      maxHp,
      x: stepped.x,
      y: stepped.y,
      drawX: stepped.drawX,
      drawY: stepped.drawY,
      facing: stepped.facing,
      vx: 0,
      vy: 0,
      hitTimer: 0,
      deadTimer: null,
      destroyed: false,
      userSpawned: false,
    });
  }

  return {
    biomeId: biome.id,
    tileMap,
    crackMap: new Uint8Array(gridLen),
    rubbleMap: new Uint8Array(gridLen),
    clearedFloraMask: new Uint8Array(gridLen),
    entities,
    particles: [],
    popups: [],
    backdropDirty: true,
    shakeTimer: 0,
    shakeIntensity: 0,
    effectTickAccum: 0,
    nextEntityUid: 1,
    quakeCount: 0,
    destroyedStructures: 0,
    creaturesSlain: 0,
    totalDamageDealt: 0,
  };
}

export function renderBiomeSimBackdrop(
  biome: BiomeDefinition,
  state: BiomeWorldState
): PixelBuffer {
  state.backdropDirty = false;
  return renderBiomeBackdropFromGrid(
    biome,
    state.tileMap,
    state.crackMap,
    state.rubbleMap,
    state.clearedFloraMask
  );
}

function clampTile(tx: number, ty: number): [number, number] {
  return [
    Math.max(0, Math.min(GRID_COLS - 1, tx)),
    Math.max(0, Math.min(GRID_ROWS - 1, ty)),
  ];
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 0.0001) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / lenSq));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function isLand(t: TopDownTileType): boolean {
  return t !== 'deepWater' && t !== 'midWater' && t !== 'shallowWater';
}

export function isSimWaterPixel(state: BiomeWorldState, px: number, py: number): boolean {
  const [tx, ty] = clampTile(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  return !isLand(state.tileMap[ty * GRID_COLS + tx]);
}

function stampRubbleAround(
  state: BiomeWorldState,
  cx: number,
  cy: number,
  tileRadius: number,
  stoneRubble: boolean
): void {
  const ctx = Math.floor(cx / TILE_SIZE);
  const cty = Math.floor(cy / TILE_SIZE);
  for (let dy = -tileRadius; dy <= tileRadius; dy++) {
    for (let dx = -tileRadius; dx <= tileRadius; dx++) {
      if (dx * dx + dy * dy > tileRadius * tileRadius + 1) continue;
      const [tx, ty] = clampTile(ctx + dx, cty + dy);
      const idx = ty * GRID_COLS + tx;
      if (!isLand(state.tileMap[idx])) continue;
      state.clearedFloraMask[idx] = 1;
      if ((Math.abs(tx * 7 + ty * 13) % 3) !== 0) {
        state.rubbleMap[idx] = stoneRubble ? 2 : 1;
      }
      if (state.tileMap[idx] === 'grass' || state.tileMap[idx] === 'accentBiome') {
        state.tileMap[idx] = 'path';
      }
    }
  }
}

function damageEntity(
  state: BiomeWorldState,
  ent: BiomeSimEntity,
  amount: number,
  knockX: number,
  knockY: number,
  popupColor = '#FF6B4A'
): void {
  if (ent.destroyed || ent.deadTimer !== null || ent.model.kind === 'weather') return;

  const dmg = Math.max(1, Math.round(amount));
  ent.hp = Math.max(0, ent.hp - dmg);
  state.totalDamageDealt += dmg;

  if (ent.model.kind === 'unit' || ent.model.kind === 'aquatic') {
    ent.hitTimer = 0.65;
    ent.vx += knockX;
    ent.vy += knockY;
    state.popups.push({
      x: ent.x,
      y: ent.y - ent.model.height * 0.7,
      vy: -18,
      life: 0.9,
      maxLife: 0.9,
      text: `-${dmg}`,
      color: popupColor,
    });

    if (ent.hp <= 0) {
      ent.deadTimer = 1.4;
      state.creaturesSlain += 1;
    }
  } else {
    // Structures, trees, ores
    state.popups.push({
      x: ent.x,
      y: ent.y - ent.model.height * 0.65,
      vy: -15,
      life: 0.85,
      maxLife: 0.85,
      text: `-${dmg}`,
      color: '#FBBF24',
    });

    if (ent.hp <= 0) {
      ent.destroyed = true;
      const isStruct = ent.model.kind === 'static' || ent.model.kind === 'animated';
      if (isStruct) state.destroyedStructures += 1;
      stampRubbleAround(state, ent.x, ent.y - 4, isStruct ? 3 : 2, isStruct);
      state.backdropDirty = true;

      const debrisCount = isStruct ? 16 : 9;
      for (let i = 0; i < debrisCount; i++) {
        const ang = (i / debrisCount) * Math.PI * 2;
        const spd = 16 + (i % 4) * 10;
        state.particles.push({
          x: ent.x + (i % 5) - 2,
          y: ent.y - 8,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd * 0.6 - 18,
          life: 0.75 + (i % 3) * 0.15,
          maxLife: 0.95,
          size: isStruct ? 2 : 1,
          color: isStruct ? (i % 2 === 0 ? '#9E968E' : '#574F49') : '#734F2C',
        });
      }
    }
  }
}

/**
 * Triggers a branching tectonic Earthquake directly at logical map (cx, cy):
 * - Alters terrain tileMap (pale uplifted sand crust + central mountain rock ridge + deep fissure cracks)
 * - Destroys trees & damages/collapses buildings into rubble
 * - Inflicts real damage, hit reaction, knockback, and death states on nearby creatures
 */
export function applyEarthquakeAt(
  state: BiomeWorldState,
  _biome: BiomeDefinition,
  cx: number,
  cy: number,
  seedOffset = 0
): void {
  const seed = state.quakeCount * 73 + Math.round(cx) * 11 + Math.round(cy) * 19 + seedOffset;
  const angle = ((seed % 360) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const perpX = -sin;
  const perpY = cos;

  // Jagged branching tectonic spine (6 segments spanning ~96px) + 5 branching fault arms
  const spinePts: [number, number][] = [];
  for (let i = 0; i <= 5; i++) {
    const u = (i - 2.5) / 2.5;
    const zig = Math.sin(i * 2.1 + seed) * 10;
    spinePts.push([cx + u * 46 * cos + zig * perpX, cy + u * 46 * sin + zig * perpY]);
  }

  const branchSegments: { x1: number; y1: number; x2: number; y2: number; width: number; isMain: boolean }[] = [];
  for (let i = 0; i < spinePts.length - 1; i++) {
    branchSegments.push({
      x1: spinePts[i][0],
      y1: spinePts[i][1],
      x2: spinePts[i + 1][0],
      y2: spinePts[i + 1][1],
      width: i === 2 ? 12 : 9,
      isMain: true,
    });
  }
  for (let b = 0; b < 8; b++) {
    const base = spinePts[b % spinePts.length];
    const side = b % 2 === 0 ? 1 : -1;
    const bAng = angle + side * (0.6 + (b % 4) * 0.28);
    const len = 26 + (b % 3) * 11;
    branchSegments.push({
      x1: base[0],
      y1: base[1],
      x2: base[0] + Math.cos(bAng) * len,
      y2: base[1] + Math.sin(bAng) * len,
      width: b % 3 === 0 ? 6.5 : 4.2,
      isMain: b < 3,
    });
  }

  // 1. Mutate terrain tiles directly along the fault geometry (matching image_b1c8a830.png)
  const minTx = Math.max(0, Math.floor((cx - 82) / TILE_SIZE));
  const maxTx = Math.min(GRID_COLS - 1, Math.ceil((cx + 82) / TILE_SIZE));
  const minTy = Math.max(0, Math.floor((cy - 82) / TILE_SIZE));
  const maxTy = Math.min(GRID_ROWS - 1, Math.ceil((cy + 82) / TILE_SIZE));

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const idx = ty * GRID_COLS + tx;
      const tile = state.tileMap[idx];
      if (!isLand(tile)) continue;

      const px = tx * TILE_SIZE + 2;
      const py = ty * TILE_SIZE + 2;
      const jitter = (((tx * 37 + ty * 61 + seed) & 15) / 15 - 0.5) * 3.8;

      let bestNorm = 999;
      let hitMain = false;
      for (const seg of branchSegments) {
        const d = distToSegment(px, py, seg.x1, seg.y1, seg.x2, seg.y2) + jitter;
        const norm = d / seg.width;
        if (norm < bestNorm) {
          bestNorm = norm;
          hitMain = seg.isMain;
        }
      }

      if (bestNorm <= 1.32) {
        state.clearedFloraMask[idx] = 1;
        if (bestNorm <= 0.44 && hitMain) {
          // Central uplifted rock mountain ridge
          state.tileMap[idx] = 'rock';
          state.crackMap[idx] = 2;
        } else if (bestNorm <= 0.65 && hitMain) {
          state.tileMap[idx] = 'rock';
          state.crackMap[idx] = Math.max(state.crackMap[idx], 1);
        } else {
          // Outer uplifted pale sand/subsoil collar (signature of image_b1c8a830.png!)
          if (tile !== 'rock' && tile !== 'snow') {
            state.tileMap[idx] = 'shore';
          }
          if (bestNorm <= 0.6) {
            state.crackMap[idx] = Math.max(state.crackMap[idx], 1);
          }
        }
      }
    }
  }

  // 2. Apply structural destruction & creature shockwave damage
  const shockRadius = 86;
  for (const ent of state.entities) {
    if (ent.destroyed || ent.deadTimer !== null || ent.model.kind === 'weather') continue;
    const ey = ent.y - ent.model.height * 0.25;
    const dist = Math.hypot(ent.x - cx, ey - cy);

    let faultDist = dist;
    for (const seg of branchSegments) {
      const d = distToSegment(ent.x, ey, seg.x1, seg.y1, seg.x2, seg.y2);
      if (d < faultDist) faultDist = d;
    }

    if (dist > shockRadius && faultDist > 26) continue;

    const falloff = Math.max(0.3, 1 - Math.min(dist, faultDist * 2.2) / shockRadius);
    const nx = dist > 1 ? (ent.x - cx) / dist : 1;
    const ny = dist > 1 ? (ey - cy) / dist : -1;

    if (ent.model.kind === 'nature' || ent.model.kind === 'static' || ent.model.kind === 'animated') {
      const structDmg = faultDist < 24 ? 115 : Math.round(75 * falloff);
      damageEntity(state, ent, structDmg, 0, 0);
    } else if (ent.model.kind === 'substance') {
      damageEntity(state, ent, Math.round(55 * falloff), 0, 0);
    } else {
      const unitDmg = Math.round(38 + 34 * falloff);
      damageEntity(state, ent, unitDmg, nx * 42 * falloff, ny * 32 * falloff, '#FF6B4A');
    }
  }

  // 3. Seismic dust plume & rock splinters burst
  for (let i = 0; i < 24; i++) {
    const p = spinePts[i % spinePts.length];
    const ang = (i / 24) * Math.PI * 2;
    const spd = 14 + (i % 5) * 9;
    state.particles.push({
      x: p[0] + (i % 7) - 3,
      y: p[1] + ((i * 3) % 5) - 2,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd * 0.55 - 16,
      life: 0.7 + (i % 3) * 0.18,
      maxLife: 1.05,
      size: i % 3 === 0 ? 2 : 1,
      color: i % 2 === 0 ? '#DFCA86' : '#8F8D89',
    });
  }

  state.quakeCount += 1;
  state.shakeTimer = 0.75;
  state.shakeIntensity = 5.5;
  state.backdropDirty = true;
}

/**
 * Spawns any model from the catalog directly onto the 2D biome map.
 */
export function spawnBiomeModelAt(
  state: BiomeWorldState,
  model: PixelModelDef,
  x: number,
  y: number
): BiomeSimEntity {
  const clampedX = Math.max(20, Math.min(BIOME_WIDTH - 20, Math.round(x)));
  const clampedY = Math.max(36, Math.min(BIOME_HEIGHT - 12, Math.round(y)));
  const uid = `user-${model.id}-${state.nextEntityUid++}`;

  let layer: BiomeLayer = 'ground';
  let patrolSpan: number | undefined;
  let patrolSpanY: number | undefined;
  let patrolSpeed: number | undefined;
  let hoverBob: number | undefined;
  let unitMode: 'walk' | 'swim' | undefined;

  if (model.kind === 'weather') {
    layer = 'sky';
    const isStorm = model.id in TORNADO_POWER || model.id === 'weather-thundercloud';
    patrolSpan = isStorm ? 72 : 34;
    patrolSpanY = isStorm ? 28 : 8;
    patrolSpeed = isStorm ? 0.08 : 0.045;
  } else if (model.kind === 'aquatic') {
    layer = 'water';
    patrolSpan = 52;
    patrolSpanY = 8;
    patrolSpeed = 0.1;
    unitMode = 'swim';
  } else if (model.kind === 'unit') {
    if (FLYING_MODEL_IDS.has(model.id)) {
      layer = 'air';
      patrolSpan = 74;
      patrolSpanY = 20;
      patrolSpeed = 0.11;
      hoverBob = 3;
    } else {
      layer = 'ground';
      patrolSpan = 24;
      patrolSpanY = 9;
      patrolSpeed = 0.13;
      unitMode = 'walk';
    }
  }

  const placement: BiomePlacement = {
    id: uid,
    modelId: model.id,
    x: clampedX,
    y: clampedY,
    layer,
    patrolSpan,
    patrolSpanY,
    patrolSpeed,
    hoverBob,
    unitMode,
    phaseOffset: (state.nextEntityUid * 0.9) % (Math.PI * 2),
    role: model.subtitle.split('(')[0].trim() || model.name,
  };

  // Clear ambient trees right under newly placed ground buildings/ores
  if (layer === 'ground' && (model.kind === 'static' || model.kind === 'animated' || model.kind === 'substance')) {
    const [ctx, cty] = clampTile(Math.floor(clampedX / TILE_SIZE), Math.floor((clampedY - 6) / TILE_SIZE));
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const [tx, ty] = clampTile(ctx + dx, cty + dy);
        state.clearedFloraMask[ty * GRID_COLS + tx] = 1;
      }
    }
    state.backdropDirty = true;
  }

  const maxHp = getInitialEntityHp(model);
  const ent: BiomeSimEntity = {
    id: uid,
    placement,
    model,
    hp: maxHp,
    maxHp,
    x: clampedX,
    y: clampedY,
    drawX: Math.round(clampedX - model.width / 2),
    drawY: Math.round(clampedY - model.height),
    facing: -1,
    vx: 0,
    vy: 0,
    hitTimer: 0,
    deadTimer: null,
    destroyed: false,
    userSpawned: true,
  };

  state.entities.push(ent);
  return ent;
}

export function removeBiomeEntityById(state: BiomeWorldState, entityId: string): boolean {
  const before = state.entities.length;
  state.entities = state.entities.filter((e) => e.id !== entityId);
  return state.entities.length !== before;
}

/**
 * Advances simulation: entity patrol, knockback damping, tornado/firestorm/acid-geyser
 * environmental destruction & damage ticks, screen-shake, and particles/popups.
 */
export function stepBiomeSim(
  state: BiomeWorldState,
  _biome: BiomeDefinition,
  dt: number,
  simTime: number
): void {
  if (state.shakeTimer > 0) {
    state.shakeTimer = Math.max(0, state.shakeTimer - dt);
  }

  // 1. Update entity positions, hit timers, knockback, and death decay
  for (const ent of state.entities) {
    if (ent.destroyed) continue;

    if (ent.deadTimer !== null) {
      ent.deadTimer -= dt;
      if (ent.deadTimer <= 0) {
        ent.destroyed = true;
      }
      continue;
    }

    if (ent.hitTimer > 0) {
      ent.hitTimer = Math.max(0, ent.hitTimer - dt);
    }

    // Apply knockback impulse to anchor position so creatures physically get thrown
    if (Math.abs(ent.vx) > 0.2 || Math.abs(ent.vy) > 0.2) {
      ent.placement.x = Math.max(20, Math.min(BIOME_WIDTH - 20, ent.placement.x + ent.vx * dt));
      ent.placement.y = Math.max(36, Math.min(BIOME_HEIGHT - 12, ent.placement.y + ent.vy * dt));
      const damp = Math.pow(0.08, dt);
      ent.vx *= damp;
      ent.vy *= damp;
    }

    const stepped = stepBiomePlacement(ent.placement, ent.model, simTime);
    ent.x = stepped.x;
    ent.y = stepped.y;
    ent.drawX = stepped.drawX;
    ent.drawY = stepped.drawY;
    ent.facing = stepped.facing;
  }

  // 2. Environmental hazard ticks (Tornadoes, Firestorm, Acid Geyser) every 0.45s
  state.effectTickAccum += dt;
  if (state.effectTickAccum >= 0.45) {
    state.effectTickAccum -= 0.45;

    for (const src of state.entities) {
      if (src.destroyed || src.deadTimer !== null) continue;

      const storm = TORNADO_POWER[src.model.id];
      if (storm) {
        const footX = src.x;
        const footY = src.y - 4;

        // Tornado scours trees & grass along its path
        if (storm.scoursTiles) {
          const [tx, ty] = clampTile(Math.floor(footX / TILE_SIZE), Math.floor(footY / TILE_SIZE));
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const [cx, cy] = clampTile(tx + dx, ty + dy);
              const idx = cy * GRID_COLS + cx;
              if (state.clearedFloraMask[idx] === 0 && isLand(state.tileMap[idx])) {
                state.clearedFloraMask[idx] = 1;
                state.backdropDirty = true;
              }
              if ((dx === 0 && dy === 0) && (state.tileMap[idx] === 'grass' || state.tileMap[idx] === 'accentBiome')) {
                state.tileMap[idx] = 'path';
                state.backdropDirty = true;
              }
            }
          }
        }

        // Tornado damages nearby buildings/trees & hurls creatures
        for (const tgt of state.entities) {
          if (tgt === src || tgt.destroyed || tgt.deadTimer !== null || tgt.model.kind === 'weather') continue;
          const d = Math.hypot(tgt.x - footX, tgt.y - footY);
          if (d <= storm.radius) {
            const nx = d > 1 ? (tgt.x - footX) / d : 1;
            const ny = d > 1 ? (tgt.y - footY) / d : -1;
            // Swirl tangentially + outward
            const swirlX = -ny * storm.pull + nx * (storm.pull * 0.35);
            const swirlY = nx * storm.pull * 0.7 + ny * (storm.pull * 0.3);
            const dmgScale = tgt.model.kind === 'static' || tgt.model.kind === 'animated' ? 0.85 : 1;
            damageEntity(
              state,
              tgt,
              Math.max(4, Math.round(storm.dmg * dmgScale)),
              swirlX,
              swirlY,
              src.model.id === 'vfx-firestorm' ? '#FF9E2C' : '#7DD3FC'
            );
          }
        }
      } else if (src.model.id === 'acid-geyser') {
        // Acid geyser hurts creatures wandering directly beside its toxic pool
        for (const tgt of state.entities) {
          if (tgt === src || tgt.destroyed || tgt.deadTimer !== null) continue;
          if (tgt.model.kind !== 'unit') continue;
          const d = Math.hypot(tgt.x - src.x, tgt.y - src.y);
          if (d <= 22) {
            damageEntity(state, tgt, 10, (tgt.x - src.x) * 0.6, (tgt.y - src.y) * 0.6, '#A3FF3B');
            state.particles.push({
              x: tgt.x,
              y: tgt.y - 6,
              vx: 0,
              vy: -14,
              life: 0.5,
              maxLife: 0.5,
              size: 2,
              color: '#9BFF2E',
            });
          }
        }
      }
    }
  }

  // 3. Advance active particles & floating damage numbers
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pt = state.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += 36 * dt; // subtle pixel gravity
  }

  for (let i = state.popups.length - 1; i >= 0; i--) {
    const pop = state.popups[i];
    pop.life -= dt;
    if (pop.life <= 0) {
      state.popups.splice(i, 1);
      continue;
    }
    pop.y += pop.vy * dt;
  }

  // Prune fully decayed entities
  state.entities = state.entities.filter((e) => !e.destroyed);
}

export function toSteppedEntities(entities: BiomeSimEntity[]): SteppedEntity[] {
  return entities
    .filter((e) => !e.destroyed)
    .map((e) => ({
      placement: e.placement,
      model: e.model,
      x: e.x,
      y: e.y,
      facing: e.facing,
      drawX: e.drawX,
      drawY: e.drawY,
    }));
}
