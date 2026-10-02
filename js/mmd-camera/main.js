import * as THREE from './vendor/three.module.min.js';
import { MMDLoader } from './vendor/loaders/MMDLoader.js';
import { MMDAnimationHelper } from './vendor/animation/MMDAnimationHelper.js';
import { Parser } from './vendor/libs/mmdparser.module.js';
import { collectAssets, createAssetURLs, droppedFiles, isModel, isMotion, coverRect } from './assets.js';

const $ = id => document.getElementById(id);
const parser = new Parser();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 2000);
const modelGroup = new THREE.Group();
scene.add(modelGroup, new THREE.HemisphereLight(0xffffff, 0x788474, 1.2));
const keyLight = new THREE.DirectionalLight(0xfff5e9, 1.4);
keyLight.position.set(-15, 30, 30);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xdfeaff, 0.5);
fillLight.position.set(20, 15, -20);
scene.add(fillLight);

let renderer, mesh, helper, modelResources, motion, action;
let duration = 0, position = 0, playing = false, busy = false;
let stream = null, cameraRequest = 0, cameraPending = false, photoURL = null;
let lastFrame = performance.now(), lastUI = 0, dragDepth = 0;
let modelHeight = 20, modelCenter = new THREE.Vector3(0, 10, 0);
let orbit = { theta: 0, phi: Math.PI / 2, distance: 50, x: 0, y: 0 };
const backgroundColor = '#232b27';
const WHITE_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=';

function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function refreshControls() {
  for (const id of ['import-model', 'import-folder', 'import-motion', 'sample', 'remove-model', 'remove-motion']) $(id).disabled = busy || !renderer;
  for (const id of ['model-scale', 'model-x', 'model-y', 'reset-view', 'turn-left', 'turn-right']) $(id).disabled = !mesh || busy;
  for (const id of ['play', 'restart', 'timeline', 'speed']) $(id).disabled = !action || busy;
  $('capture').disabled = (!mesh && !stream) || !renderer || busy || cameraPending;
  $('empty-stage').hidden = !!mesh || !!stream;
  $('play').setAttribute('aria-label', playing ? '暂停动作' : '播放动作');
  $('play-icon').setAttribute('href', playing ? '#i-pause' : '#i-play');
}

async function runImport(task) {
  if (busy || !renderer) return;
  busy = true;
  refreshControls();
  message('正在读取本地文件…');
  try { await task(); }
  catch (error) {
    console.warn('MMD Camera import:', error);
    message(error.userMessage || '导入失败。请确认文件格式完整，角色的贴图与模型一起导入。', true);
  } finally { busy = false; refreshControls(); }
}

function userError(text) { const error = new Error(text); error.userMessage = text; return error; }

async function chooseAsset(names, title) {
  if (names.length === 1) return names[0];
  const dialog = $('asset-picker');
  $('picker-title').textContent = title;
  $('picker-list').replaceChildren();
  return new Promise(resolve => {
    let selected = null;
    for (const name of names) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = name;
      button.addEventListener('click', () => { selected = name; dialog.close(); });
      $('picker-list').append(button);
    }
    dialog.addEventListener('close', () => resolve(selected), { once: true });
    dialog.showModal();
  });
}

function disposeMesh(object) {
  if (!object) return;
  object.geometry.dispose();
  object.skeleton?.dispose();
  const textures = new Set();
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

function detachAnimation() {
  if (helper && mesh) {
    const mixer = helper.objects.get(mesh)?.mixer;
    mixer?.stopAllAction(); mixer?.uncacheRoot(mesh);
    helper.remove(mesh);
  }
  helper = null; action = null; playing = false; position = 0; duration = 0;
}

function releaseModel() {
  detachAnimation();
  if (mesh) { modelGroup.remove(mesh); disposeMesh(mesh); }
  modelResources?.dispose(); modelResources = null; mesh = null;
}

async function restorePackedTextures(assets) {
  // This project stores some RGBA textures as JPEG RGB + a grayscale PNG mask.
  // Reassemble them before giving the image to the standard Three.js loader.
  for (const [name, color] of assets) {
    if (!/\.jpga\.jpg$/i.test(name)) continue;
    const alpha = assets.get(name.replace(/\.jpga\.jpg$/i, '.alpha.png'));
    if (!alpha) continue;
    const rgb = await createImageBitmap(color), mask = await createImageBitmap(alpha);
    try {
      const canvas = document.createElement('canvas'); canvas.width = rgb.width; canvas.height = rgb.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(mask, 0, 0, rgb.width, rgb.height);
      const maskPixels = context.getImageData(0, 0, rgb.width, rgb.height);
      context.clearRect(0, 0, rgb.width, rgb.height);
      context.drawImage(rgb, 0, 0);
      const pixels = context.getImageData(0, 0, rgb.width, rgb.height);
      for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] = maskPixels.data[i + 2];
      context.putImageData(pixels, 0, 0);
      const texture = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (texture) assets.set(name, texture);
    } finally { rgb.close(); mask.close(); }
  }
}

async function loadModel(assets, name) {
  message('正在加载角色与贴图…');
  await restorePackedTextures(assets);
  const baseURL = new URL(`./__mmd_camera__/${crypto.randomUUID()}/`, location.href).href;
  const resources = createAssetURLs(assets, baseURL);
  const missing = new Set();
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const resolved = resources.resolve(url);
    if (resolved) return resolved;
    missing.add(url.replace(baseURL, ''));
    return WHITE_PIXEL;
  });
  manager.onError = url => missing.add(url);
  let textureRequests = 0;
  const itemStart = manager.itemStart.bind(manager);
  manager.itemStart = url => { textureRequests++; itemStart(url); };
  const texturesReady = new Promise(resolve => { manager.onLoad = resolve; });
  const loader = new MMDLoader(manager);
  let nextMesh;
  try {
    const data = await assets.get(name).arrayBuffer();
    const parsed = /\.pmx$/i.test(name) ? parser.parsePmx(data, true) : parser.parsePmd(data, true);
    const folder = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
    const texturePath = baseURL + folder.split('/').map(encodeURIComponent).join('/');
    nextMesh = loader.meshBuilder.build(parsed, texturePath);
    if (textureRequests) await texturesReady;
    // Validate a retained motion against the new skeleton before replacing the old model.
    let nextClip;
    if (motion) {
      nextClip = loader.animationBuilder.build(motion.data, nextMesh);
      if (!nextClip.tracks.length) nextClip = null;
    }
    releaseModel();
    mesh = nextMesh; modelResources = resources;
    mesh.frustumCulled = false;
    modelGroup.rotation.y = 0;
    modelGroup.add(mesh);
    mesh.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    modelHeight = Math.max(bounds.max.y - bounds.min.y, 1);
    modelCenter = bounds.getCenter(new THREE.Vector3());
    resetView();
    $('model-name').textContent = name.split('/').pop();
    $('model-detail').textContent = `${/\.pmx$/i.test(name) ? 'PMX' : 'PMD'} · ${mesh.skeleton.bones.length} 个骨骼`;
    $('model-card').hidden = false;
    if (nextClip) { nextClip.duration = Math.max(nextClip.duration, 1 / 30); applyAnimation(nextClip); }
    else if (motion) {
      // Keep the imported motion available, but make incompatibility visible.
      $('motion-detail').textContent = '与当前角色不匹配，等待替换角色';
    }
    syncTimeline();
    if (missing.size) message(`角色已导入。${missing.size} 张贴图缺失或无法读取，请将完整贴图与模型一起导入。`, true);
    else if (motion && !nextClip) message('角色已导入；当前动作没有匹配的骨骼或表情，请更换动作或角色。', true);
    else message('角色已登场。开启摄像头，或导入动作开始拍摄。');
  } catch (error) { if (nextMesh !== mesh) { disposeMesh(nextMesh); resources.dispose(); } throw error; }
}

function buildClip(data, object) {
  const clip = new MMDLoader().animationBuilder.build(data, object);
  if (!clip.tracks.length) throw userError('这段动作没有与当前角色匹配的骨骼或表情，请尝试其他动作或角色。');
  clip.duration = Math.max(clip.duration, 1 / 30);
  return clip;
}

function applyAnimation(clip) {
  detachAnimation();
  mesh.pose();
  if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
  helper = new MMDAnimationHelper({ sync: false });
  // Keep this first camera edition focused on bone/morph motion and posing.
  helper.add(mesh, { animation: clip, physics: false });
  action = helper.objects.get(mesh).mixer.clipAction(clip);
  duration = Math.max(clip.duration, 1 / 30);
  configureLoop();
  helper.update(0);
  playing = true;
  $('timeline').max = String(duration);
  $('motion-detail').textContent = `VMD · ${duration.toFixed(1)} 秒`;
  refreshControls(); syncTimeline();
}

function configureLoop() {
  if (!action) return;
  action.setLoop($('loop').checked ? THREE.LoopRepeat : THREE.LoopOnce, $('loop').checked ? Infinity : 1);
  action.clampWhenFinished = true;
}

async function loadMotion(assets, name) {
  const data = parser.parseVmd(await assets.get(name).arrayBuffer(), true);
  if (!data.motions.length && !data.morphs.length) throw userError('这个 VMD 只包含相机或灯光数据，请选择角色的骨骼或表情动作。');
  const clip = mesh ? buildClip(data, mesh) : null;
  motion = { data, name };
  $('motion-name').textContent = name.split('/').pop();
  $('motion-card').hidden = false;
  $('motion-hint').hidden = true;
  if (clip) { applyAnimation(clip); message('动作已导入并开始播放。暂停后也可以拍摄当前姿势。'); }
  else { $('motion-detail').textContent = '已就绪，等待导入角色'; message('动作已准备好，导入角色后即可播放。'); }
}

async function importAssets(files, kind) {
  if (!files.length) return;
  await runImport(async () => {
    const assets = await collectAssets(files, window.JSZip);
    const models = [...assets.keys()].filter(isModel).sort();
    const motions = [...assets.keys()].filter(isMotion).sort();
    if (kind !== 'motion' && models.length) {
      const name = await chooseAsset(models, '选择要入镜的角色');
      if (!name) { message('已取消导入。'); return; }
      await loadModel(assets, name);
      if (kind === 'drop' && motions.length) {
        const motionName = await chooseAsset(motions, '选择要播放的动作');
        if (motionName) await loadMotion(assets, motionName);
      }
    } else if (kind !== 'model' && motions.length) {
      const name = await chooseAsset(motions, '选择要播放的动作');
      if (name) await loadMotion(assets, name);
      else message('已取消导入。');
    } else throw userError(kind === 'motion' ? '没有找到 VMD 动作，请选择 .vmd 或包含动作的 ZIP。' : '没有找到 PMX/PMD 角色，请选择完整的角色文件夹、ZIP 或模型文件。');
  });
}

function resetView() {
  const radians = camera.fov * Math.PI / 180;
  const fit = modelHeight / (2 * Math.tan(radians / 2)) * 1.25;
  orbit = { theta: 0, phi: Math.PI / 2, distance: fit, x: 0, y: 0 };
  $('model-scale').value = '100'; $('model-x').value = '0'; $('model-y').value = '0';
  modelGroup.rotation.y = 0;
  updateView();
}

function updateView() {
  const scale = Number($('model-scale').value) / 100;
  const x = Number($('model-x').value), y = Number($('model-y').value);
  const distance = orbit.distance / scale;
  const visibleHeight = distance * 2 * Math.tan(camera.fov * Math.PI / 360);
  const target = modelCenter.clone();
  const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, orbit.phi, orbit.theta));
  // Translate camera and target together in camera space, preserving the framing.
  const right = new THREE.Vector3(Math.cos(orbit.theta), 0, -Math.sin(orbit.theta));
  const up = new THREE.Vector3().crossVectors(offset.clone().normalize(), right).normalize();
  target.addScaledVector(right, orbit.x - x / 200 * visibleHeight * camera.aspect);
  target.addScaledVector(up, orbit.y - y / 200 * visibleHeight);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = Math.max(2000, distance * 20);
  camera.updateProjectionMatrix();
  $('scale-value').textContent = `${Math.round(scale * 100)}%`;
  $('x-value').textContent = String(x); $('y-value').textContent = String(y);
}

function resize() {
  if (!renderer) return;
  const { width, height } = $('stage').getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  updateView();
}

function timecode(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function syncTimeline() {
  $('timeline').value = String(position);
  $('current-time').textContent = timecode(position);
  $('total-time').textContent = timecode(duration);
}

function seek(time) {
  if (!action) return;
  position = THREE.MathUtils.clamp(time, 0, duration);
  // Rebuild the current pose from animation rather than accumulating IK corrections.
  mesh.pose();
  const state = helper.objects.get(mesh);
  state.backupBones = undefined;
  action.paused = false; action.enabled = true;
  // LoopRepeat wraps an exact endpoint to frame zero even on update(0).
  action.time = Math.min(position, Math.max(duration - 0.000001, 0));
  helper.update(0);
  syncTimeline();
}

function tick(now) {
  requestAnimationFrame(tick);
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  if (document.hidden || !renderer) return;
  if (playing && helper && action && !busy && !$('photo-dialog').open) {
    const step = delta * Number($('speed').value);
    helper.update(step);
    position = action.time;
    if (!$('loop').checked && position >= duration) { position = duration; playing = false; refreshControls(); }
  }
  renderer.render(scene, camera);
  if (now - lastUI > 100) { syncTimeline(); lastUI = now; }
}

function cameraState() {
  $('camera-toggle').classList.toggle('active', !!stream);
  $('camera-toggle').querySelector('span').textContent = cameraPending ? '等待摄像头权限…' : stream ? '关闭摄像头' : '开启摄像头';
  $('camera-toggle').disabled = cameraPending || !renderer;
  $('camera-device').disabled = !stream || cameraPending || $('camera-device').options.length < 2;
  $('camera-status').textContent = stream ? '摄像头已开启 · 本机画面' : '摄像头未开启';
  $('camera-dot').style.background = stream ? '#b6d284' : '#7b8776';
  $('webcam').hidden = !stream; $('stage-grid').hidden = !!stream;
  refreshControls();
}

function stopCamera() {
  cameraRequest++;
  const previous = stream; stream = null;
  for (const track of previous?.getTracks() || []) track.stop();
  $('webcam').srcObject = null;
  cameraPending = false; cameraState();
}

async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
  const selected = stream?.getVideoTracks()[0]?.getSettings().deviceId;
  $('camera-device').replaceChildren();
  devices.forEach((device, i) => { $('camera-device').add(new Option(device.label || `摄像头 ${i + 1}`, device.deviceId)); });
  $('camera-device').disabled = !stream || cameraPending || devices.length < 2;
  if (selected) $('camera-device').value = selected;
  if (!devices.length) $('camera-device').add(new Option('默认摄像头', ''));
}

async function startCamera(deviceId) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    message('摄像头需要通过 localhost 或 HTTPS 打开页面，请使用本地启动服务。', true); return;
  }
  const request = ++cameraRequest;
  cameraPending = true; cameraState();
  let acquired;
  try {
    acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }), width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (request !== cameraRequest) { acquired.getTracks().forEach(track => track.stop()); return; }
    const previous = stream;
    $('webcam').srcObject = acquired;
    await $('webcam').play();
    if (request !== cameraRequest) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    previous?.getTracks().forEach(track => track.stop());
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
      if (stream === acquired) { stopCamera(); message('摄像头连接已结束，可以重新开启。', true); }
    });
    await listCameras();
    message('摄像头已开启。调整角色的位置和大小，就可以拍照了。');
  } catch (error) {
    acquired?.getTracks().forEach(track => track.stop());
    $('webcam').srcObject = stream;
    const errors = { NotAllowedError: '摄像头权限被拒绝。请在浏览器中允许摄像头后重试。', NotFoundError: '没有找到可用摄像头，请连接设备后重试。', NotReadableError: '摄像头无法读取，可能正被其他应用占用。', OverconstrainedError: '选中的摄像头已不可用，请选择其他设备。' };
    message(errors[error.name] || '摄像头开启失败，请检查设备和浏览器权限。', true);
  } finally {
    if (request === cameraRequest) { cameraPending = false; cameraState(); await listCameras().catch(() => {}); }
  }
}

async function capture() {
  if ($('capture').disabled) return;
  try {
    const aspect = camera.aspect;
    const width = aspect < 1 ? 1080 : 1920;
    const height = Math.round(width / aspect);
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    const context = output.getContext('2d');
    context.fillStyle = backgroundColor; context.fillRect(0, 0, width, height);
    const video = $('webcam');
    if (stream) {
      if (video.readyState < 2 || !video.videoWidth) throw userError('摄像头画面还未准备好，请稍后再拍。');
      context.save();
      if ($('mirror').checked) { context.translate(width, 0); context.scale(-1, 1); }
      context.drawImage(video, ...coverRect(video.videoWidth, video.videoHeight, width, height), 0, 0, width, height);
      context.restore();
    }
    // Render at export resolution; crop and model framing match the live viewport.
    const previewSize = renderer.getSize(new THREE.Vector2()), pixelRatio = renderer.getPixelRatio();
    try {
      renderer.setPixelRatio(1); renderer.setSize(width, height, false);
      renderer.render(scene, camera); context.drawImage(renderer.domElement, 0, 0, width, height);
    } finally { renderer.setPixelRatio(pixelRatio); renderer.setSize(previewSize.x, previewSize.y, false); }
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Photo export failed');
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = URL.createObjectURL(blob);
    $('photo-preview').src = photoURL; $('download-photo').href = photoURL;
    $('download-photo').download = `mmd-camera-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    $('photo-dialog').showModal();
    message(`照片已生成 · ${width} × ${height}，点击「保存照片」即可下载。`);
  } catch (error) { message(error.userMessage || '照片生成失败，请重试。', true); }
}

// Pointer controls support mouse and one/two-finger touch without taking over page scrolling.
const pointers = new Map();
let gesture;
function snapshotGesture() {
  const values = [...pointers.values()];
  if (!values.length) return null;
  if (values.length === 1) return { x: values[0].x, y: values[0].y, distance: 0 };
  return { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2, distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) };
}
$('render-canvas').addEventListener('pointerdown', event => {
  if (!mesh || busy) return;
  event.preventDefault();
  $('render-canvas').setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture = snapshotGesture();
});
$('render-canvas').addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId) || !gesture) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const next = snapshotGesture(), dx = next.x - gesture.x, dy = next.y - gesture.y;
  if (pointers.size > 1 || event.shiftKey || event.buttons === 2) {
    const units = orbit.distance * 2 * Math.tan(camera.fov * Math.PI / 360) / $('stage').clientHeight;
    orbit.x -= dx * units; orbit.y += dy * units;
    if (next.distance && gesture.distance) orbit.distance = THREE.MathUtils.clamp(orbit.distance * gesture.distance / next.distance, modelHeight * .2, modelHeight * 30);
  } else {
    orbit.theta -= dx * .008;
    orbit.phi = THREE.MathUtils.clamp(orbit.phi - dy * .008, .05, Math.PI - .05);
  }
  gesture = next; updateView();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('render-canvas').addEventListener(name, event => { pointers.delete(event.pointerId); gesture = snapshotGesture(); });
$('render-canvas').addEventListener('contextmenu', event => event.preventDefault());
$('render-canvas').addEventListener('wheel', event => {
  if (!mesh) return;
  event.preventDefault();
  orbit.distance = THREE.MathUtils.clamp(orbit.distance * Math.exp(event.deltaY * .001), modelHeight * .2, modelHeight * 30);
  updateView();
}, { passive: false });

for (const [button, input, kind] of [['import-model', 'model-files', 'model'], ['import-folder', 'model-folder', 'model'], ['import-motion', 'motion-files', 'motion']]) {
  $(button).addEventListener('click', () => $(input).click());
  $(input).addEventListener('change', () => { const files = Array.from($(input).files); $(input).value = ''; importAssets(files, kind); });
}
$('picker-cancel').addEventListener('click', () => $('asset-picker').close());
$('sample').addEventListener('click', () => runImport(async () => {
  const response = await fetch('jThree/model/alicia.min.zip');
  if (!response.ok) throw new Error('Example model unavailable');
  const file = new File([await response.blob()], 'alicia.zip');
  const assets = await collectAssets([file], window.JSZip);
  await loadModel(assets, 'Alicia_solid_v02.pmx');
  const motionResponse = await fetch('MMD.js/motion/motion_basic_pack01.zip');
  if (!motionResponse.ok) throw new Error('Example motion unavailable');
  const motions = await collectAssets([new File([await motionResponse.blob()], 'motion.zip')], window.JSZip);
  await loadMotion(motions, 'standmix2_modified.vmd');
  message('示例角色与动作已加载。开启摄像头，试试第一张同框照片。');
}));
$('remove-model').addEventListener('click', () => {
  releaseModel(); $('model-card').hidden = true;
  if (motion) $('motion-detail').textContent = '已就绪，等待导入角色';
  syncTimeline(); refreshControls(); message('角色已移除，可以导入新的角色。');
});
$('remove-motion').addEventListener('click', () => {
  detachAnimation(); mesh?.pose();
  if (mesh?.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
  motion = null; $('motion-card').hidden = true; $('motion-hint').hidden = false;
  syncTimeline(); refreshControls(); message('动作已移除，角色回到初始姿势。');
});
$('camera-toggle').addEventListener('click', () => { if (stream) { stopCamera(); message('摄像头已关闭，角色仍可单独拍照。'); } else startCamera(); });
$('camera-device').addEventListener('change', () => startCamera($('camera-device').value));
navigator.mediaDevices?.addEventListener('devicechange', () => { if (stream) listCameras().catch(() => {}); });
$('mirror').addEventListener('change', () => $('webcam').classList.toggle('mirrored', $('mirror').checked));
for (const id of ['model-scale', 'model-x', 'model-y']) $(id).addEventListener('input', updateView);
$('reset-view').addEventListener('click', resetView);
$('turn-left').addEventListener('click', () => { modelGroup.rotation.y += Math.PI / 12; });
$('turn-right').addEventListener('click', () => { modelGroup.rotation.y -= Math.PI / 12; });
$('aspect').addEventListener('change', () => {
  const [w, h] = $('aspect').value.split(':').map(Number);
  $('stage').style.aspectRatio = `${w}/${h}`;
  $('stage-shell').classList.toggle('portrait', w < h);
  $('stage-shell').classList.toggle('square', w === h);
  resize();
});
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('stage-shell').requestFullscreen(); }
  catch { message('当前浏览器不支持全屏取景。', true); }
});
$('play').addEventListener('click', () => {
  if (!action) return;
  if (!playing && position >= duration) seek(0);
  playing = !playing; refreshControls();
});
$('restart').addEventListener('click', () => seek(0));
$('timeline').addEventListener('input', () => seek(Number($('timeline').value)));
$('loop').addEventListener('change', configureLoop);
$('capture').addEventListener('click', capture);
$('close-photo').addEventListener('click', () => $('photo-dialog').close());
document.addEventListener('dragenter', event => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false;
});
document.addEventListener('dragover', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
document.addEventListener('drop', async event => {
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  try {
    // Capture entries before awaiting: DataTransfer becomes inaccessible after dispatch.
    const files = event.dataTransfer.items.length ? await droppedFiles(event.dataTransfer.items) : Array.from(event.dataTransfer.files);
    await importAssets(files, 'drop');
  } catch { message('无法读取拖入的文件，请使用导入按钮或文件夹选择。', true); }
});
window.addEventListener('pagehide', () => { stopCamera(); if (photoURL) URL.revokeObjectURL(photoURL); });

try {
  renderer = new THREE.WebGLRenderer({ canvas: $('render-canvas'), alpha: true, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  new ResizeObserver(resize).observe($('stage'));
  resize(); refreshControls(); cameraState(); requestAnimationFrame(tick);
  if (location.protocol === 'file:') message('请通过本地服务打开页面：在项目文件夹运行 node XRA_node_server.js。', true);
} catch (error) {
  console.error('MMD Camera renderer:', error);
  $('empty-stage').querySelector('strong').textContent = '当前浏览器无法开启 3D 预览';
  $('empty-stage').querySelector('p').textContent = '请使用支持 WebGL 的浏览器，并开启硬件加速。';
  message('3D 预览初始化失败，请检查浏览器的 WebGL 与硬件加速设置。', true);
  refreshControls(); cameraState();
}
