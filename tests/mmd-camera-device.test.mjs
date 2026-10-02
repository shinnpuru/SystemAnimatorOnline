import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraController, cameraConstraints, cameraFacing, deviceCamera } from '../js/mmd-camera/camera.js';

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function mediaStream(facing = 'environment') {
  const track = new EventTarget(); track.readyState = 'live'; track.stops = 0;
  track.getSettings = () => ({ facingMode: facing, deviceId: facing === 'user' ? 'front-id' : 'rear-id' });
  track.stop = () => { track.stops++; track.readyState = 'ended'; track.dispatchEvent(new Event('ended')); };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
function fixture() {
  const streams = [], calls = [], states = [], delays = [];
  let ended = 0;
  const video = { srcObject: null, play: async () => {} };
  const mediaDevices = {
    getUserMedia: async constraints => {
      calls.push(constraints);
      // Reproduce a phone that refuses simultaneous front and rear capture.
      if (streams.some(stream => stream.track.readyState === 'live')) throw new DOMException('Camera busy', 'NotReadableError');
      const v = constraints.video;
      const facing = v.deviceId ? v.deviceId.exact === 'front-id' ? 'user' : 'environment' : v.facingMode.exact || v.facingMode.ideal;
      const stream = mediaStream(facing); streams.push(stream); return stream;
    }
  };
  const camera = new CameraController({ mediaDevices, video, onState: state => states.push(state), onEnded: () => ended++, delay: async ms => delays.push(ms) });
  return { camera, video, mediaDevices, streams, calls, states, delays, get ended() { return ended; } };
}

test('default constraints prefer the rear camera; explicit choices never mix facing and device ID', () => {
  assert.deepEqual(cameraConstraints().video.facingMode, { ideal: 'environment' });
  assert.equal(cameraConstraints().audio, false);
  assert.deepEqual(cameraConstraints('user', true).video.facingMode, { exact: 'user' });
  assert.deepEqual(cameraConstraints(deviceCamera('rear-id')).video.deviceId, { exact: 'rear-id' });
  assert.equal(cameraConstraints(deviceCamera('rear-id')).video.facingMode, undefined);
});

test('opening and switching works with a phone that permits only one active camera', async () => {
  const f = fixture(); await f.camera.start();
  assert.equal(cameraFacing(f.camera.stream, f.camera.selection), 'environment');
  const rear = f.camera.stream;
  const result = await f.camera.start('user', { strictFacing: true });
  assert.equal(result.stream, f.camera.stream); assert.equal(f.camera.selection, 'user');
  assert.equal(rear.track.readyState, 'ended'); assert.equal(f.ended, 0);
  assert.equal(f.calls.length, 2); assert.equal(f.video.srcObject, result.stream);
  await f.camera.start('environment', { strictFacing: true });
  assert.equal(f.camera.selection, 'environment'); assert.equal(f.streams.filter(s => s.track.readyState === 'live').length, 1);
  f.camera.stop(); assert.equal(f.video.srcObject, null);
});

test('a missing requested camera reacquires the previous device and restores its selection', async () => {
  const f = fixture(); await f.camera.start();
  const original = f.camera.stream, open = f.mediaDevices.getUserMedia;
  f.mediaDevices.getUserMedia = async constraints => {
    if (constraints.video.facingMode?.exact === 'user') throw new DOMException('Missing', 'OverconstrainedError');
    return open(constraints);
  };
  const result = await f.camera.start('user', { strictFacing: true });
  assert.equal(result.error.name, 'OverconstrainedError'); assert.equal(result.restored, true);
  assert.notEqual(f.camera.stream, original); assert.equal(original.track.readyState, 'ended');
  assert.equal(f.camera.selection, 'environment'); assert.equal(f.video.srcObject, f.camera.stream);
  assert.equal(f.calls.at(-1).video.deviceId.exact, 'rear-id'); assert.equal(f.camera.pending, false);
  f.camera.stop();
});

test('mobile driver release delay retries a busy switch once', async () => {
  const f = fixture(); await f.camera.start();
  const open = f.mediaDevices.getUserMedia; let attempts = 0;
  f.mediaDevices.getUserMedia = async constraints => {
    if (constraints.video.facingMode?.exact === 'user' && !attempts++) throw new DOMException('Releasing hardware', 'NotReadableError');
    return open(constraints);
  };
  const result = await f.camera.start('user', { strictFacing: true });
  assert.ok(result.stream); assert.equal(attempts, 2); assert.deepEqual(f.delays, [180]);
  f.camera.stop();
});

test('permission refusal does not prompt again to restore a previous camera', async () => {
  const f = fixture(); await f.camera.start(); let requests = 0;
  f.mediaDevices.getUserMedia = async () => { requests++; throw new DOMException('Denied', 'NotAllowedError'); };
  const result = await f.camera.start('user', { strictFacing: true });
  assert.equal(result.restored, false); assert.equal(requests, 1);
  assert.equal(f.camera.stream, null); assert.equal(f.video.srcObject, null); assert.equal(f.camera.pending, false);
});

test('a late permission grant after stop is released without attaching to video', async () => {
  const f = fixture(), pending = deferred(), late = mediaStream();
  f.mediaDevices.getUserMedia = () => pending.promise;
  const starting = f.camera.start(); f.camera.stop(); pending.resolve(late);
  assert.equal((await starting).cancelled, true);
  assert.equal(late.track.readyState, 'ended'); assert.equal(f.video.srcObject, null); assert.equal(f.camera.pending, false);
});

test('stop during video startup releases the candidate and a late play result cannot clear a newer video', async () => {
  const f = fixture(), play = deferred(); f.video.play = () => play.promise;
  const starting = f.camera.start(); await Promise.resolve(); await Promise.resolve();
  const candidate = f.camera.candidate; assert.ok(candidate);
  f.camera.stop(); assert.equal(candidate.track.readyState, 'ended');
  f.video.play = async () => {}; await f.camera.start('user'); const newer = f.camera.stream;
  play.resolve(); assert.equal((await starting).cancelled, true);
  assert.equal(f.camera.stream, newer); assert.equal(f.video.srcObject, newer); assert.equal(newer.track.readyState, 'live');
  f.camera.stop();
});

test('a cancelled old switch cannot restore over a newer camera when its rejection arrives late', async () => {
  const f = fixture(); await f.camera.start(); const open = f.mediaDevices.getUserMedia, pending = deferred();
  f.mediaDevices.getUserMedia = () => pending.promise;
  const old = f.camera.start('user', { strictFacing: true }); f.camera.stop();
  f.mediaDevices.getUserMedia = open; await f.camera.start(); const newer = f.camera.stream;
  pending.reject(new DOMException('Missing', 'NotFoundError'));
  assert.equal((await old).cancelled, true); assert.equal(f.camera.stream, newer); assert.equal(f.video.srcObject, newer);
  f.camera.stop();
});

test('an ended active track clears camera state, while explicitly stopping does not report a disconnection', async () => {
  const f = fixture(); await f.camera.start(); f.camera.stream.track.stop();
  assert.equal(f.ended, 1); assert.equal(f.camera.stream, null); assert.equal(f.video.srcObject, null);
  await f.camera.start(); f.camera.stop(); assert.equal(f.ended, 1);
});

test('playback failure releases acquired capture and returns an idle camera', async () => {
  const f = fixture(); f.video.play = async () => { throw new Error('Video failed'); };
  const result = await f.camera.start(); assert.equal(result.error.message, 'Video failed');
  assert.equal(f.streams[0].track.readyState, 'ended'); assert.equal(f.camera.pending, false); assert.equal(f.video.srcObject, null);
});

test('a desktop fallback reports its actual front camera rather than claiming a rear camera', async () => {
  const f = fixture(); f.mediaDevices.getUserMedia = async () => mediaStream('user');
  await f.camera.start(); assert.equal(f.camera.selection, 'user');
  assert.equal(cameraFacing(f.camera.stream, f.camera.selection), 'user'); f.camera.stop();
});

test('a pending camera request is exclusive and cancelling driver delay prevents a new request', async () => {
  const f = fixture(); await f.camera.start(); const delay = deferred(); let requests = 0;
  f.camera.delay = () => delay.promise;
  f.mediaDevices.getUserMedia = async () => { requests++; throw new DOMException('Busy', 'NotReadableError'); };
  const starting = f.camera.start('user'); await Promise.resolve(); await Promise.resolve();
  assert.equal((await f.camera.start('environment')).busy, true);
  f.camera.stop(); delay.resolve(); assert.equal((await starting).cancelled, true); assert.equal(requests, 1);
});
