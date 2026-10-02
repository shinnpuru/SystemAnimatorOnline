import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { estimateLighting, temperatureRGB } from '../js/mmd-camera/light-estimation.js';
import { models, motions } from '../js/mmd-camera/catalog.js';
import { Parser } from '../js/mmd-camera/vendor/libs/mmdparser.module.js';
import * as THREE from '../js/mmd-camera/vendor/three.module.min.js';
import { MMDLoader } from '../js/mmd-camera/vendor/loaders/MMDLoader.js';
import { buildInBindPose } from '../js/mmd-camera/animation.js';
const require = createRequire(import.meta.url), JSZip = require('../js/jszip.js');

function pixels(color) {
  const width = 32, height = 32, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...color(x / width, y / height), 255], (y * width + x) * 4);
  return { width, height, data };
}
test('flat and dark photos do not invent a confident light direction', () => {
  const flat = estimateLighting(pixels(() => [160, 160, 160]));
  const dark = estimateLighting(pixels(() => [0, 0, 0]));
  assert.equal(flat.confidence, 'diffuse'); assert.equal(dark.confidence, 'dark');
  assert.equal(flat.temperature, 6500); assert.ok(flat.intensity > dark.intensity);
  for (const value of Object.values(dark).filter(value => typeof value === 'number')) assert.ok(Number.isFinite(value));
});
test('bright left and right windows produce opposite directions and top light is elevated', () => {
  const left = estimateLighting(pixels((x, y) => x < .4 && y < .4 ? [240, 235, 225] : [65, 60, 55]));
  const right = estimateLighting(pixels((x, y) => x > .6 && y < .4 ? [240, 235, 225] : [65, 60, 55]));
  assert.equal(left.confidence, 'directional'); assert.equal(right.confidence, 'directional');
  assert.ok(left.azimuth < -20); assert.ok(right.azimuth > 20);
  assert.ok(left.elevation > 35); assert.ok(right.elevation > 35);
});
test('warm and cool neutral photos estimate different color temperatures', () => {
  const warm = estimateLighting(pixels(() => [210, 180, 150]));
  const cool = estimateLighting(pixels(() => [150, 180, 210]));
  assert.ok(warm.temperature < 5500); assert.ok(cool.temperature > 7500);
  const warmRGB = temperatureRGB(warm.temperature), coolRGB = temperatureRGB(cool.temperature);
  assert.ok(warmRGB[0] > warmRGB[2]); assert.ok(coolRGB[2] > coolRGB[0]);
});
test('transparent regions are excluded and fully empty photos are rejected', () => {
  const image = pixels(() => [160, 160, 160]);
  for (let i = 0; i < image.data.length / 2; i += 4) image.data.set([255, 0, 0, 0], i);
  assert.equal(estimateLighting(image).temperature, 6500);
  image.data.fill(0); assert.throws(() => estimateLighting(image), /No visible/);
  assert.throws(() => estimateLighting({ width: 2, height: 2, data: [] }), /Invalid/);
});
test('every bundled motion exists, parses and animates both advertised models', async () => {
  const parser = new Parser();
  const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const skeletons = [];
  for (const model of models) {
    const zip = await JSZip.loadAsync(await readFile(new URL(`../${model.path}`, import.meta.url)));
    const entry = zip.file(model.entry); assert.ok(entry, model.label);
    const pmx = parser.parsePmx(arrayBuffer(await entry.async('uint8array')), true);
    skeletons.push(new Set(pmx.bones.map(bone => bone.name)));
  }
  assert.equal(new Set(motions.map(item => item.id)).size, motions.length);
  for (const motion of motions) {
    const vmd = parser.parseVmd(arrayBuffer(await readFile(new URL(`../${motion.path}`, import.meta.url))), true);
    assert.ok(vmd.motions.length > 0, motion.label);
    for (const bones of skeletons) assert.ok(vmd.motions.some(frame => bones.has(frame.boneName)), `${motion.label} must animate the model`);
  }
});

test('switching motions uses bind-pose offsets and preserves the live pose even on failure', () => {
  const bone = new THREE.Bone(); bone.name = 'center'; bone.position.y = 2;
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
  bone.position.set(1, -8, 3); bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .4);
  const animated = bone.position.clone(), rotation = bone.quaternion.clone();
  const data = { metadata: { motionCount: 1, morphCount: 0 }, motions: [{ boneName: 'center', frameNum: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], interpolation: Array(64).fill(64) }], morphs: [] };
  const clip = buildInBindPose(new MMDLoader().animationBuilder, data, mesh);
  assert.deepEqual([...clip.tracks.find(track => track.name.endsWith('.position')).values], [0, 2, 0]);
  assert.ok(bone.position.equals(animated)); assert.ok(bone.quaternion.equals(rotation));
  assert.throws(() => buildInBindPose({ build() { throw new Error('Bad motion'); } }, data, mesh), /Bad motion/);
  assert.ok(bone.position.equals(animated)); assert.ok(bone.quaternion.equals(rotation));
});
