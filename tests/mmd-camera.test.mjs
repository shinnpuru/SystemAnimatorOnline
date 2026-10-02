import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectAssets, createAssetURLs, findAsset, normalizePath, coverRect, decodeZipName, droppedFiles } from '../js/mmd-camera/assets.js';
const require = createRequire(import.meta.url);
const JSZip = require('../js/jszip.js');

test('Japanese texture paths survive ZIP import with nested folders', async () => {
  const zip = new JSZip();
  zip.file('モデル/角色.pmx', 'model');
  zip.file('モデル/tex/目.png', 'texture');
  const file = await zip.generateAsync({ type: 'nodebuffer' });
  file.name = 'model.zip';
  const assets = await collectAssets([file], JSZip);
  assert.equal(await assets.get('モデル/tex/目.png').text(), 'texture');
  assert.equal(assets.get('モデル/tex/目.png').type, 'image/png');
  assert.equal(assets.size, 2);
});

test('Windows paths and parent-relative texture references resolve', () => {
  assert.equal(normalizePath('モデル\\mesh\\..\\textures\\skin.png'), 'モデル/textures/skin.png');
  const assets = new Map([['角色/Tex/EYE.PNG', new Blob(['eye'])]]);
  assert.equal(findAsset(assets, '角色/tex/eye.png'), '角色/Tex/EYE.PNG');
});

test('flat file selection falls back only to a unique texture basename', () => {
  const assets = new Map([['hair.png', 1], ['A/eye.png', 2], ['B/eye.png', 3]]);
  assert.equal(findAsset(assets, 'tex/hair.png'), 'hair.png');
  assert.equal(findAsset(assets, 'tex/eye.png'), null);
  assert.equal(findAsset(assets, 'B/eye.png'), 'B/eye.png');
});

test('local texture URLs are reused and remote references never resolve', () => {
  const base = 'http://localhost:3000/__mmd_camera__/123/';
  const resolver = createAssetURLs(new Map([['角色/eye.png', new Blob(['eye'])]]), base);
  const url = resolver.resolve(base + '%E8%A7%92%E8%89%B2/eye.png');
  assert.ok(url.startsWith('blob:'));
  assert.equal(resolver.resolve(base + '%E8%A7%92%E8%89%B2/eye.png'), url);
  assert.equal(resolver.resolve('https://example.com/eye.png'), null);
  assert.equal(resolver.resolve(base + '../eye.png'), null);
  assert.equal(resolver.resolve('data:image/png;base64,test'), 'data:image/png;base64,test');
  resolver.dispose();
});

test('Shift-JIS archive names and UTF-8 names decode correctly', () => {
  assert.equal(decodeZipName(new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67])), 'テスト');
  assert.equal(decodeZipName(new TextEncoder().encode('角色/目.png')), '角色/目.png');
});

test('portrait and square photos crop the same webcam area as object-fit cover', () => {
  assert.deepEqual(coverRect(1920, 1080, 1080, 1920), [656.25, 0, 607.5, 1080]);
  assert.deepEqual(coverRect(1920, 1080, 1080, 1080), [420, 0, 1080, 1080]);
  assert.deepEqual(coverRect(1920, 1080, 1920, 1080), [0, 0, 1920, 1080]);
});

test('folder drops read every directory batch and retain texture paths', async () => {
  const file = name => ({ isFile: true, file: resolve => resolve({ name }) });
  const batches = [[file('角色.pmx')], [file('eye.png')], []];
  const directory = { name: '角色包', isFile: false, createReader: () => ({ readEntries: resolve => resolve(batches.shift()) }) };
  const files = await droppedFiles([{ kind: 'file', webkitGetAsEntry: () => directory, getAsFile: () => null }]);
  assert.deepEqual(files.map(file => file.relativePath), ['角色包/角色.pmx', '角色包/eye.png']);
});
