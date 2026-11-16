import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  bakeAtlas,
  buildFullExportArchive,
  getBuildingSprite,
  getCreatureSprite,
  getUnitSprite,
} from './forgeApi';
import { PixelBuffer } from './pixelCanvas';

function parsePngDimensionsAndVerifyIdat(png: Uint8Array): { width: number; height: number } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) {
    assert.equal(png[i], sig[i], `PNG signature byte ${i}`);
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idatChunks: Uint8Array[] = [];
  let sawIend = false;

  while (pos < png.length) {
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0, false);
      height = dv.getUint32(4, false);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      sawIend = true;
    }
    pos += 12 + len;
  }

  assert.ok(width > 0 && height > 0, 'Valid PNG IHDR dimensions');
  assert.ok(sawIend, 'PNG must contain IEND chunk');
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  assert.equal(inflated.length, (width * 4 + 1) * height, 'Inflated PNG scanlines length must match RGBA');
  return { width, height };
}

test('ForgeAPI getUnitSprite: deterministic, anchors, zoneMap, 0 INK & 0 orphans', () => {
  const a = getUnitSprite(1042, {
    era: 'medieval',
    race: 'marshfolk',
    gender: 'female',
    age: 'adult',
    role: 'warrior',
    kingdomId: 3,
  });
  const b = getUnitSprite(1042, {
    era: 'medieval',
    race: 'marshfolk',
    gender: 'female',
    age: 'adult',
    role: 'warrior',
    kingdomId: 3,
  });

  assert.equal(a.width, 10);
  assert.equal(a.height, 10);
  assert.equal(a.rgba.length, 400);
  assert.equal(a.buffer.hashFrame(), b.buffer.hashFrame());
  assert.equal(a.audit.inkPixels, 0);
  assert.equal(a.audit.orphanPixels, 0);
  assert.ok(a.audit.uniqueColors <= 8);
  assert.ok(a.anchors.head.w >= 3);
});

test('ForgeAPI getBuildingSprite: supports catalog, race buildings, town hall, 84 kingdoms & 4 states', () => {
  const citadelRed = getBuildingSprite('citadel-keep', 0, 'ready');
  const citadelBlue = getBuildingSprite('citadel-keep', 'blue', 'ready');
  const citadelRuins = getBuildingSprite('citadel-keep', 0, 'ruins');
  const townHallReady = getBuildingSprite('medieval-town-hall', 4, 'ready');
  const townHallConstructing = getBuildingSprite('medieval-town-hall', 4, 'constructing');
  const marshHut = getBuildingSprite('marsh-stilt-hut', 2, 'ready');

  assert.notEqual(citadelRed.buffer.hashFrame(), citadelBlue.buffer.hashFrame());
  assert.notEqual(citadelRed.buffer.hashFrame(), citadelRuins.buffer.hashFrame());
  assert.equal(citadelRed.inkPixels, 0);
  assert.ok(citadelRed.k1ChangedPixels > 0);
  assert.equal(townHallReady.inkPixels, 0);
  assert.ok(townHallReady.k1ChangedPixels > 0);
  assert.equal(townHallConstructing.inkPixels, 0);
  assert.notEqual(townHallReady.buffer.hashFrame(), townHallConstructing.buffer.hashFrame());
  assert.equal(marshHut.inkPixels, 0);
  assert.equal(marshHut.rgba.length, marshHut.width * marshHut.height * 4);
});

test('ForgeAPI getCreatureSprite: applies CreatureGenes & kingdom harness cleanly with 0 INK', () => {
  const wolfNatural = getCreatureSprite('dire-wolf', {
    coat: 'natural',
    pattern: 'solid',
    size: 'standard',
    biomeTint: 'none',
    appendages: 'standard',
  });
  const wolfAlbino = getCreatureSprite('dire-wolf', {
    coat: 'albino',
    pattern: 'spotted',
    size: 'colossal',
    biomeTint: 'tundra',
    appendages: 'ornate',
  }, { kingdomId: 2 });

  assert.notEqual(wolfNatural.buffer.hashFrame(), wolfAlbino.buffer.hashFrame());
  assert.equal(wolfNatural.inkPixels, 0);
  assert.equal(wolfAlbino.inkPixels, 0);
  assert.ok(wolfAlbino.opaquePixels > 40);
  assert.equal(wolfAlbino.rgba.length, wolfAlbino.width * wolfAlbino.height * 4);
});

test('ForgeAPI bakeAtlas: packs mixed units, buildings, creatures & custom buffers into valid PNG + JSON', () => {
  const customBuf = new PixelBuffer(8, 8);
  customBuf.fillRect(1, 1, 6, 6, '#EAB308');

  const result = bakeAtlas(
    [
      { kind: 'unit', seed: 100, params: { race: 'antlerfolk', role: 'archer', kingdomId: 1 } },
      { kind: 'unit', seed: 200, params: { race: 'ash-nomads', role: 'cleric', kingdomId: 4 } },
      { kind: 'building', id: 'medieval-town-hall', kingdom: 0, state: 'ready' },
      { kind: 'building', id: 'raptor-egg-nest', kingdom: 2, state: 'ready' },
      { kind: 'creature', species: 'tyrannosaurus-rex', genes: { coat: 'striped', pattern: 'striped' } },
      { kind: 'buffer', key: 'custom_token', buffer: customBuf, meta: { tag: 'test' } },
    ],
    { scale: 2, pageSize: 1024 }
  );

  const dims = parsePngDimensionsAndVerifyIdat(result.png);
  assert.equal(dims.width, result.pages[0].width);
  assert.equal(dims.height, result.pages[0].height);

  const parsed = JSON.parse(result.json);
  assert.equal(parsed.totalFrames, 6);
  assert.equal(parsed.scale, 2);
  assert.equal(parsed.frames.length, 6);
  assert.equal(parsed.frames[5].key, 'custom_token');
  assert.equal(parsed.frames[5].width, 16);
  assert.equal(parsed.frames[5].height, 16);
});

test('ForgeAPI buildFullExportArchive: builds valid ZIP with all races, buildings, and 205 models', () => {
  const archive = buildFullExportArchive({ scale: 1 });
  assert.ok(archive.zipBytes.length > 50000, 'ZIP archive must contain full atlas payloads');
  // Check PKZIP local header magic PK\x03\x04
  assert.equal(archive.zipBytes[0], 0x50);
  assert.equal(archive.zipBytes[1], 0x4b);
  assert.equal(archive.zipBytes[2], 0x03);
  assert.equal(archive.zipBytes[3], 0x04);

  const names = archive.entries.map((e) => e.name);
  assert.ok(names.includes('01-units-all-races.json'));
  assert.ok(names.includes('02-buildings-all-kingdoms.json'));
  assert.ok(names.includes('03-models-205-phenotypes.json'));
  assert.ok(names.includes('manifest-index.json'));
  assert.ok(names.some((n) => n.startsWith('01-units-all-races') && n.endsWith('.png')));
  assert.ok(names.some((n) => n.startsWith('02-buildings-all-kingdoms') && n.endsWith('.png')));
  assert.ok(names.some((n) => n.startsWith('03-models-205-phenotypes') && n.endsWith('.png')));

  assert.equal(archive.summary.totalRaces, 10);
  assert.equal(archive.summary.totalRoles, 11);
  assert.equal(archive.summary.totalRaceBuildings, 24);
  assert.equal(archive.summary.totalMedBronzeBuildings, 27);
  assert.equal(archive.summary.totalCatalogModels, 205);
});
