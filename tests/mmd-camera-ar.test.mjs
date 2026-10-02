import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../js/mmd-camera/vendor/three.module.min.js';
import { SpatialAR } from '../js/mmd-camera/spatial-ar.js';

const tick = () => new Promise(resolve => queueMicrotask(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const placement = { height: 20, center: new THREE.Vector3(0, 10, 0), minY: 0 };
function pose(x = 1, y = 0, z = -2, rotation = new THREE.Quaternion()) {
  return { transform: { matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(1, 1, 1)).toArray() } };
}
function fixture() {
  const scene = new THREE.Scene(), model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(2, 20, 2).translate(0, 10, 0), new THREE.MeshBasicMaterial()));
  scene.add(model);
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, .1, 2000);
  camera.position.set(3, 4, 50);
  const local = new EventTarget(), source = { cancellations: 0, cancel() { this.cancellations++; } };
  const session = new EventTarget();
  session.requestReferenceSpace = async () => local;
  session.requestHitTestSource = async () => source;
  session.ends = 0;
  session.end = async () => { session.ends++; session.dispatchEvent(new Event('end')); };
  const calls = [];
  const xr = { isSessionSupported: async () => true, requestSession: async (...args) => { calls.push(args); return session; } };
  const renderer = { xr: { getReferenceSpace: () => local, setReferenceSpaceType() {}, setSession: async () => {} } };
  const states = [];
  const ar = new SpatialAR({ renderer, scene, camera, model, overlay: {}, xr, secure: true, onState: state => states.push(state) });
  const frame = {
    session, hits: [], viewer: { transform: { position: { x: 0, y: 1.6, z: 0 } } }, anchorPose: pose(),
    getViewerPose() { return this.viewer; }, getHitTestResults() { return this.hits; }, getPose() { return this.anchorPose; }
  };
  const anchor = { anchorSpace: {}, deletions: 0, delete() { this.deletions++; } };
  const hit = { getPose: () => pose(), createAnchor: async () => anchor };
  return { ar, scene, model, camera, renderer, xr, session, source, states, frame, hit, anchor, calls, local };
}
async function start(f) { await f.ar.detectSupport(); assert.equal(await f.ar.start(placement), true); }
async function place(f) { f.frame.hits = [f.hit]; f.ar.update(f.frame); assert.equal(f.ar.place(), true); f.ar.update(f.frame); await tick(); }

test('capability detection never requests a session and handles unavailable/insecure devices', async () => {
  const f = fixture();
  assert.equal(await f.ar.detectSupport(), 'available'); assert.equal(f.calls.length, 0);
  f.xr.isSessionSupported = async () => false;
  assert.equal(await f.ar.detectSupport(), 'unsupported');
  await assert.rejects(f.ar.start(placement)); assert.equal(f.calls.length, 0);
  f.ar.secure = false;
  assert.equal(await f.ar.detectSupport(), 'insecure'); assert.equal(f.ar.locked, false);
});

test('permission rejection restores idle state and allows a later entry', async () => {
  const f = fixture(); await f.ar.detectSupport();
  f.xr.requestSession = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(f.ar.start(placement), { name: 'NotAllowedError' });
  assert.equal(f.ar.locked, false); assert.equal(f.model.parent, f.scene);
  assert.deepEqual(f.camera.position.toArray(), [3, 4, 50]);
  f.xr.requestSession = async () => f.session;
  assert.equal(await f.ar.start(placement), true);
  await f.ar.end();
});

test('walls and absent hits cannot place a character; valid ground centers its feet at meter scale', async () => {
  const f = fixture(); await start(f);
  f.ar.update(f.frame); assert.equal(f.ar.place(), false);
  f.frame.hits = [{ getPose: () => pose(1, 0, -2, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)) }];
  f.ar.update(f.frame); assert.equal(f.ar.canPlace, false);
  await place(f);
  f.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(f.model);
  assert.ok(Math.abs(bounds.min.y) < 1e-8); assert.ok(Math.abs(bounds.max.y - 1.2) < 1e-8);
  assert.deepEqual(f.ar.root.position.toArray(), [1, 0, -2]);
  f.ar.setHeight(.4); f.scene.updateMatrixWorld(true);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(f.model).max.y - .4) < 1e-8);
  await f.ar.end();
});

test('anchor motion updates placement and tracking loss hides then restores the character', async () => {
  const f = fixture(); await start(f); await place(f);
  f.ar.turn(Math.PI / 4); const facing = f.ar.root.rotation.y;
  f.frame.anchorPose = pose(2, .3, -3, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .2));
  f.ar.update(f.frame);
  assert.deepEqual(f.ar.root.position.toArray(), [2, .3, -3]);
  assert.ok(Math.abs(f.ar.root.rotation.y - facing - .2) < 1e-8);
  f.frame.anchorPose = null; f.ar.update(f.frame);
  assert.equal(f.ar.root.visible, false); assert.equal(f.ar.phase, 'tracking-lost');
  f.frame.anchorPose = pose(2, .3, -3); f.ar.update(f.frame);
  assert.equal(f.ar.root.visible, true); assert.equal(f.ar.phase, 'placed');
  f.frame.viewer = null; f.ar.update(f.frame); assert.equal(f.ar.root.visible, false);
  await f.ar.end();
});

test('optional anchor rejection still keeps a fixed placement as the viewer moves', async () => {
  const f = fixture(); f.hit.createAnchor = async () => { throw new DOMException('No anchors', 'NotSupportedError'); };
  await start(f); await place(f); await tick();
  assert.equal(f.ar.anchor, null);
  f.frame.viewer.transform.position.x = 3; f.ar.update(f.frame);
  assert.deepEqual(f.ar.root.position.toArray(), [1, 0, -2]); assert.equal(f.ar.root.visible, true);
  f.local.dispatchEvent(new Event('reset'));
  assert.equal(f.ar.placed, false); assert.equal(f.ar.phase, 'searching');
  await f.ar.end();
});

test('repositioning and exiting delete late anchors instead of reviving an old placement', async () => {
  const f = fixture(), pending = deferred(); f.hit.createAnchor = () => pending.promise;
  await start(f); await place(f); f.ar.reposition();
  pending.resolve(f.anchor); await tick();
  assert.equal(f.anchor.deletions, 1); assert.equal(f.ar.anchor, null); assert.equal(f.ar.placed, false);
  const afterExit = deferred(), late = { deletions: 0, delete() { this.deletions++; } };
  f.hit.createAnchor = () => afterExit.promise;
  await place(f); await f.ar.end(); afterExit.resolve(late); await tick();
  assert.equal(late.deletions, 1); assert.equal(f.ar.active, false);
});

test('exit releases resources exactly once and restores model, camera and animation-owned transforms', async () => {
  const f = fixture(); f.model.position.set(4, 3, 2); f.model.rotation.y = .3; f.model.scale.setScalar(2);
  const camera = f.camera.clone(), quaternion = f.model.quaternion.clone();
  await start(f); await place(f); await f.ar.end();
  assert.equal(f.source.cancellations, 1); assert.equal(f.anchor.deletions, 1);
  assert.equal(f.model.parent, f.scene); assert.deepEqual(f.model.position.toArray(), [4, 3, 2]);
  assert.deepEqual(f.model.scale.toArray(), [2, 2, 2]); assert.ok(f.model.quaternion.equals(quaternion));
  assert.ok(f.camera.position.equals(camera.position)); assert.equal(f.camera.near, camera.near); assert.equal(f.camera.far, camera.far);
  await f.ar.end(); assert.equal(f.source.cancellations, 1);
});

test('ending during hit-source initialization cancels a late source and never attaches the renderer', async () => {
  const f = fixture(), pending = deferred(); await f.ar.detectSupport();
  f.session.requestHitTestSource = () => pending.promise;
  let attachments = 0; f.renderer.xr.setSession = async () => attachments++;
  const starting = f.ar.start(placement); await tick(); await tick();
  await f.session.end(); await tick(); pending.resolve(f.source);
  assert.equal(await starting, false); assert.equal(attachments, 0); assert.equal(f.source.cancellations, 1);
  assert.equal(f.ar.locked, false); assert.equal(f.model.parent, f.scene);
});

test('renderer initialization failure ends the granted session and restores preview', async () => {
  const f = fixture(); await f.ar.detectSupport();
  f.renderer.xr.setSession = async () => { throw new Error('No XR framebuffer'); };
  await assert.rejects(f.ar.start(placement), /No XR framebuffer/);
  assert.equal(f.session.ends, 1); assert.equal(f.source.cancellations, 1);
  assert.equal(f.model.parent, f.scene); assert.deepEqual(f.model.position.toArray(), [0, 0, 0]);
  assert.deepEqual(f.camera.position.toArray(), [3, 4, 50]); assert.equal(f.ar.phase, 'idle');
});

test('a cancelled request cannot clean up a newer session when its rejection arrives late', async () => {
  const f = fixture(), pending = deferred(); await f.ar.detectSupport();
  f.xr.requestSession = () => pending.promise;
  const old = f.ar.start(placement);
  await f.ar.end(); f.xr.requestSession = async () => f.session;
  await f.ar.start(placement);
  pending.reject(new DOMException('Cancelled', 'NotAllowedError')); await assert.rejects(old);
  assert.equal(f.ar.active, true); assert.equal(f.ar.session, f.session);
  await f.ar.end();
});

test('entry is exclusive and a late grant after page exit is immediately ended', async () => {
  const f = fixture(), pending = deferred(); await f.ar.detectSupport();
  let requests = 0; f.xr.requestSession = () => { requests++; return pending.promise; };
  const starting = f.ar.start(placement);
  assert.equal(await f.ar.start(placement), false); assert.equal(requests, 1);
  await f.ar.end(); pending.resolve(f.session);
  assert.equal(await starting, false); assert.equal(f.session.ends, 1);
  assert.equal(f.ar.active, false); assert.equal(f.model.parent, f.scene);
});
