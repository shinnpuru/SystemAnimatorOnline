import * as THREE from './vendor/three.module.min.js';
import { MMDLoader } from './vendor/loaders/MMDLoader.js';
import { MMDAnimationHelper } from './vendor/animation/MMDAnimationHelper.js';
import { Parser } from './vendor/libs/mmdparser.module.js';
import { collectAssets, createAssetURLs, droppedFiles, isModel, isMotion, coverRect } from './assets.js';
import { SpatialAR } from './spatial-ar.js';
import { models, motions, bundledAsset } from './catalog.js';
import { AnimeRenderer } from './anime-renderer.js';
import { defaultLighting, estimateLighting } from './light-estimation.js';
import { buildInBindPose } from './animation.js';
import { CameraController, cameraFacing, deviceCamera, REAR_CAMERA, FRONT_CAMERA } from './camera.js';

const $ = id => document.getElementById(id);
const parser = new Parser();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 2000);
const modelGroup = new THREE.Group();
scene.add(modelGroup);

let renderer, mesh, helper, modelResources, motion, action;
let duration = 0, position = 0, playing = false, busy = false;
let stream = null, cameraPending = false, cameraListRequest = 0, photoURL = null;
let lastFrame = performance.now(), lastUI = 0, dragDepth = 0;
let modelHeight = 20, modelMinY = 0, modelCenter = new THREE.Vector3(0, 10, 0);
let spatialAR, arResumeCamera = null, arCameraRestore = null, leavingPage = false;
let studio, backgroundPhoto = null, backgroundURL = null, backgroundRequest = 0;
let modelSelection = '', motionSelection = '', lastLightSample = 0;
const lightCanvas = document.createElement('canvas'); lightCanvas.width = lightCanvas.height = 96;
const lightContext = lightCanvas.getContext('2d', { willReadFrequently: true });
let orbit = { theta: 0, phi: Math.PI / 2, distance: 50, x: 0, y: 0 };
const backgroundColor = '#232b27';
const WHITE_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=';
const cameraController = new CameraController({
  mediaDevices: navigator.mediaDevices, video: $('webcam'),
  onState(state) { stream = state.stream; cameraPending = state.pending; cameraState(); },
  onEnded() { message('摄像头连接已结束，可以重新开启。', true); }
});

function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function refreshControls() {
  const arLocked = !!spatialAR?.locked;
  for (const id of ['import-model', 'import-folder', 'import-motion', 'model-library', 'motion-library', 'remove-model', 'remove-motion']) $(id).disabled = busy || !renderer || arLocked;
  for (const id of ['import-background', 'remove-background', 'match-light']) $(id).disabled = !renderer || arLocked;
  $('match-light').disabled ||= !stream && !backgroundPhoto;
  $('follow-light').disabled = !stream || arLocked;
  for (const id of ['model-scale', 'model-x', 'model-y', 'reset-view', 'turn-left', 'turn-right']) $(id).disabled = !mesh || busy || arLocked;
  for (const id of ['play', 'restart', 'timeline', 'speed']) $(id).disabled = !action || busy;
  $('capture').disabled = (!mesh && !stream && !backgroundPhoto) || !renderer || busy || cameraPending || arLocked;
  for (const id of ['camera-toggle', 'mobile-camera']) $(id).disabled = cameraPending || !renderer || arLocked;
  $('camera-device').disabled = cameraPending || !renderer || arLocked;
  $('camera-flip').disabled = !stream || cameraPending || !renderer || arLocked;
  $('ar-toggle').disabled = !renderer || busy || cameraPending || arLocked || spatialAR?.support === 'checking';
  $('ar-play').disabled = !action || busy;
  $('empty-stage').hidden = !!mesh || !!stream || !!backgroundPhoto;
  $('play').setAttribute('aria-label', playing ? '暂停动作' : '播放动作');
  $('play-icon').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('ar-play').setAttribute('aria-label', playing ? '暂停动作' : '播放动作');
  $('ar-play-icon').setAttribute('href', playing ? '#i-pause' : '#i-play');
}

async function runImport(task) {
  if (busy || !renderer || spatialAR?.locked) return;
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
  studio?.detach();
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

async function loadModel(assets, name, library = {}) {
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
    studio.attach(mesh);
    mesh.frustumCulled = false;
    modelGroup.rotation.y = 0;
    modelGroup.add(mesh);
    mesh.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    modelHeight = Math.max(bounds.max.y - bounds.min.y, 1);
    modelMinY = bounds.min.y;
    modelCenter = bounds.getCenter(new THREE.Vector3());
    resetView();
    $('model-name').textContent = library.label || name.split('/').pop();
    modelSelection = library.id || 'local';
    syncLibrary('model', modelSelection, name);
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
  const clip = buildInBindPose(new MMDLoader().animationBuilder, data, object);
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

async function loadMotion(assets, name, library = {}) {
  const data = parser.parseVmd(await assets.get(name).arrayBuffer(), true);
  if (!data.motions.length && !data.morphs.length) throw userError('这个 VMD 只包含相机或灯光数据，请选择角色的骨骼或表情动作。');
  const clip = mesh ? buildClip(data, mesh) : null;
  motion = { data, name };
  $('motion-name').textContent = library.label || name.split('/').pop();
  motionSelection = library.id || 'local';
  syncLibrary('motion', motionSelection, name);
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
  if (spatialAR?.locked) return;
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
  if (!renderer || spatialAR?.locked) return;
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

function tick(now, frame) {
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  if ((document.hidden && !spatialAR?.active) || !renderer) return;
  if (frame) spatialAR?.update(frame);
  if (now - lastLightSample > 1500 && $('follow-light').checked && stream && !spatialAR?.locked && !$('photo-dialog').open) {
    lastLightSample = now; matchLighting(true);
  }
  if (playing && helper && action && !busy && !$('photo-dialog').open) {
    const step = delta * Number($('speed').value);
    helper.update(step);
    position = action.time;
    if (!$('loop').checked && position >= duration) { position = duration; playing = false; refreshControls(); }
  }
  studio.update(spatialAR?.active ? renderer.xr.getCamera(camera) : camera, modelCenter, modelHeight);
  renderer.render(scene, camera);
  if (now - lastUI > 100) { syncTimeline(); lastUI = now; }
}

function cameraState() {
  $('camera-toggle').classList.toggle('active', !!stream);
  $('camera-toggle').querySelector('span').textContent = cameraPending ? '等待摄像头权限…' : stream ? '关闭摄像头' : '开启摄像头';
  $('camera-toggle').disabled = cameraPending || !renderer || !!spatialAR?.locked;
  $('mobile-camera').disabled = cameraPending || !renderer || !!spatialAR?.locked;
  $('mobile-camera').setAttribute('aria-label', cameraPending ? '等待摄像头权限' : stream ? '关闭摄像头' : '开启摄像头');
  $('mobile-camera').setAttribute('aria-pressed', String(!!stream));
  const facing = cameraFacing(stream, cameraController.selection);
  $('camera-flip').setAttribute('aria-label', facing === FRONT_CAMERA ? '切换到后置摄像头' : '切换到前置摄像头');
  $('camera-status').textContent = cameraPending ? '正在切换摄像头…' : stream ? (facing === REAR_CAMERA ? '后置摄像头' : facing === FRONT_CAMERA ? '前置摄像头' : '摄像头已开启') : '摄像头未开启';
  $('camera-dot').style.background = stream ? '#b6d284' : '#7b8776';
  $('webcam').hidden = !stream;
  $('photo-background').hidden = !!stream || !backgroundPhoto;
  $('stage-grid').hidden = !!stream || !!backgroundPhoto;
  if (!stream && backgroundPhoto) $('camera-status').textContent = '照片背景';
  refreshControls();
}

function stopCamera() {
  cameraListRequest++;
  cameraController.stop();
}

async function listCameras() {
  const request = ++cameraListRequest, currentStream = stream;
  let devices = [];
  try { devices = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter(device => device.kind === 'videoinput' && device.deviceId); }
  catch { /* Generic front/rear choices work without a device list. */ }
  if (request !== cameraListRequest || currentStream !== stream || leavingPage) return;
  $('camera-device').replaceChildren();
  $('camera-device').add(new Option('后置摄像头（默认）', REAR_CAMERA));
  $('camera-device').add(new Option('前置摄像头', FRONT_CAMERA));
  const group = document.createElement('optgroup'); group.label = '其他镜头与设备';
  const seen = new Set();
  for (const [i, device] of devices.entries()) if (!seen.has(device.deviceId)) {
    seen.add(device.deviceId); group.append(new Option(device.label || `摄像头 ${i + 1}`, deviceCamera(device.deviceId)));
  }
  if (group.children.length) $('camera-device').append(group);
  const selection = cameraController.selection;
  $('camera-device').value = [...$('camera-device').options].some(option => option.value === selection)
    ? selection : cameraFacing(stream, selection) || REAR_CAMERA;
  refreshControls();
}

function setMirror(mirrored) { $('mirror').checked = mirrored; $('webcam').classList.toggle('mirrored', mirrored); }

async function startCamera(selection = cameraController.selection, options = {}) {
  if (spatialAR?.locked || leavingPage) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    message('摄像头需要通过 localhost 或 HTTPS 打开页面，请使用本地启动服务。', true); return;
  }
  const previousMirror = $('mirror').checked;
  const result = await cameraController.start(selection, options);
  if (result.cancelled || result.busy || leavingPage) return;
  if (result.error) {
    const error = result.error;
    const errors = { NotAllowedError: '摄像头权限被拒绝。请在浏览器中允许摄像头后重试。', NotFoundError: '没有找到可用摄像头，请连接设备后重试。', NotReadableError: '摄像头无法读取，可能正被其他应用占用。', OverconstrainedError: '选中的摄像头已不可用，请选择其他设备。' };
    let text = ['NotFoundError', 'OverconstrainedError'].includes(error.name) && !selection.startsWith('device:')
      ? `没有找到可用的${selection === REAR_CAMERA ? '后置' : '前置'}摄像头。` : errors[error.name] || '摄像头开启失败，请检查设备和浏览器权限。';
    if (result.restored) { setMirror(previousMirror); text += '已恢复原来的镜头。'; }
    message(text, true);
  } else {
    setMirror(options.mirror ?? cameraFacing(stream, cameraController.selection) === FRONT_CAMERA);
    message('摄像头已开启。可在取景栏或设置里切换前后镜头。');
  }
  await listCameras();
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
    } else if (backgroundPhoto) context.drawImage(backgroundPhoto, ...coverRect(backgroundPhoto.width, backgroundPhoto.height, width, height), 0, 0, width, height);
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

const lightKeys = Object.keys(defaultLighting);
const lightPresets = {
  studio: { ...defaultLighting },
  sunset: { ...defaultLighting, temperature: 3200, azimuth: -65, elevation: 15, ambient: 30, contrast: 75, rim: 60 },
  cool: { ...defaultLighting, temperature: 9000, azimuth: 45, elevation: 45, intensity: 75, ambient: 30, rim: 50 }
};
function updateLighting() {
  const settings = Object.fromEntries(lightKeys.map(key => [key, Number($(`light-${key}`).value)]));
  for (const [key, value] of Object.entries(settings)) {
    $(`light-${key}-value`).textContent = `${value}${key === 'temperature' ? ' K' : ['azimuth', 'elevation'].includes(key) ? '°' : '%'}`;
  }
  studio?.configure(settings);
}
function setLighting(settings, smoothing = 1) {
  for (const key of lightKeys) if (Number.isFinite(settings[key])) {
    const control = $(`light-${key}`), previous = Number(control.value);
    // Take the short route across the -180/180 boundary when following video.
    let difference = settings[key] - previous;
    if (key === 'azimuth') difference = (difference + 540) % 360 - 180;
    let value = previous + difference * smoothing;
    if (key === 'azimuth') value = (value + 540) % 360 - 180;
    control.value = String(Math.round(value / Number(control.step || 1)) * Number(control.step || 1));
  }
  updateLighting();
}
function matchLighting(follow = false) {
  const video = $('webcam'), source = stream && video.readyState >= 2 && video.videoWidth ? video : backgroundPhoto;
  if (!source) { if (!follow) $('lighting-status').textContent = '先导入背景照片，或开启摄像头后再匹配光照。'; return; }
  try {
    const width = source.videoWidth || source.width, height = source.videoHeight || source.height;
    lightContext.clearRect(0, 0, 96, 96);
    lightContext.save();
    if (source === video && $('mirror').checked) { lightContext.translate(96, 0); lightContext.scale(-1, 1); }
    // Analyze the visible crop, not parts of the photo outside the viewfinder.
    lightContext.drawImage(source, ...coverRect(width, height, camera.aspect * 96, 96), 0, 0, 96, 96);
    lightContext.restore();
    const estimate = estimateLighting(lightContext.getImageData(0, 0, 96, 96));
    setLighting(estimate, follow ? .25 : 1);
    const confidence = { dark: '画面较暗，来光方向不确定', diffuse: '光线较均匀，来光方向不确定', directional: '已估计大致来光方向' }[estimate.confidence];
    $('lighting-status').textContent = `${follow ? '跟随摄像头' : source === video ? '匹配摄像头画面' : '匹配背景照片'} · ${confidence}。可手动修正。`;
  } catch { if (!follow) $('lighting-status').textContent = '画面暂时无法读取，请重试或手动调节光照。'; }
}
for (const key of lightKeys) $(`light-${key}`).addEventListener('input', () => {
  $('follow-light').checked = false;
  updateLighting(); $('lighting-status').textContent = '手动光照。可随时再次匹配画面。';
});
for (const button of document.querySelectorAll('[data-light-preset]')) button.addEventListener('click', () => {
  $('follow-light').checked = false; setLighting(lightPresets[button.dataset.lightPreset]);
  $('lighting-status').textContent = `已应用「${button.textContent}」，可以继续微调。`;
});
$('reset-lighting').addEventListener('click', () => {
  $('follow-light').checked = false; setLighting(defaultLighting);
  $('lighting-status').textContent = '光照已恢复默认设置。';
});
$('render-style').addEventListener('change', () => studio?.setMode($('render-style').value));
$('match-light').addEventListener('click', () => { $('follow-light').checked = false; matchLighting(); });
$('follow-light').addEventListener('change', () => {
  if ($('follow-light').checked) matchLighting(true);
  else $('lighting-status').textContent = '已停止跟随，保留当前光照。';
});
$('import-background').addEventListener('click', () => $('background-file').click());
$('background-file').addEventListener('change', async () => {
  const file = $('background-file').files[0]; $('background-file').value = '';
  if (!file || spatialAR?.locked || leavingPage) return;
  const request = ++backgroundRequest;
  try {
    const bitmap = await createImageBitmap(file);
    if (request !== backgroundRequest || leavingPage || spatialAR?.locked) { bitmap.close(); return; }
    const url = URL.createObjectURL(file);
    backgroundPhoto?.close(); if (backgroundURL) URL.revokeObjectURL(backgroundURL);
    backgroundPhoto = bitmap; backgroundURL = url; $('photo-background').src = url;
    $('background-name').textContent = file.name; $('background-card').hidden = false;
    // Choosing a photo deliberately switches the background out of live video.
    if (stream || cameraPending) stopCamera();
    $('follow-light').checked = false; cameraState(); matchLighting();
    message('背景照片已加载，并已估计光照。调整角色后就可以拍照了。');
  } catch { message('无法读取这张照片，请尝试 JPG、PNG 或 WebP 格式。', true); }
});
$('remove-background').addEventListener('click', () => {
  backgroundRequest++; backgroundPhoto?.close(); backgroundPhoto = null;
  if (backgroundURL) URL.revokeObjectURL(backgroundURL); backgroundURL = null;
  $('photo-background').removeAttribute('src'); $('background-card').hidden = true;
  cameraState(); message('背景照片已移除，保留当前光照。');
});

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

// Move the existing controls into a native sheet, keeping one set of values and events.
const mobileLayout = matchMedia('(max-width: 720px), (max-width: 1000px) and (max-height: 500px)');
const sidebar = document.querySelector('.sidebar');
const preview = document.querySelector('.preview-column');
const sheet = $('mobile-sheet');
const sheetButtons = document.querySelectorAll('[data-mobile-panel]');
function closeMobileSheet() { if (sheet.open) sheet.close(); }
function openMobilePanel(panel, button) {
  if (!mobileLayout.matches) return;
  if (sheet.open) sheet.close();
  $('mobile-sheet-title').textContent = { model: '选择角色', motion: '选择动作', framing: '拍摄设置', lighting: '渲染与光照' }[panel];
  for (const section of sidebar.querySelectorAll('[data-panel]')) {
    section.hidden = section.dataset.panel !== panel && !(panel === 'framing' && ['camera', 'lighting'].includes(section.dataset.panel));
  }
  $('mobile-sheet-body').append(sidebar);
  button?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('sheet-open');
  sheet.showModal();
}
for (const button of sheetButtons) button.addEventListener('click', () => openMobilePanel(button.dataset.mobilePanel, button));
$('lighting-shortcut').addEventListener('click', () => {
  if (mobileLayout.matches) openMobilePanel('lighting');
  else $('lighting-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
sheet.addEventListener('close', () => {
  preview.before(sidebar);
  for (const section of sidebar.querySelectorAll('[data-panel]')) section.hidden = false;
  for (const button of sheetButtons) button.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('sheet-open');
});
$('close-mobile-sheet').addEventListener('click', closeMobileSheet);
sheet.addEventListener('click', event => { if (event.target === sheet && event.clientY < sheet.getBoundingClientRect().top) closeMobileSheet(); });
mobileLayout.addEventListener('change', () => { if (!mobileLayout.matches) closeMobileSheet(); });

for (const [button, input, kind] of [['import-model', 'model-files', 'model'], ['import-folder', 'model-folder', 'model'], ['import-motion', 'motion-files', 'motion']]) {
  $(button).addEventListener('click', () => $(input).click());
  $(input).addEventListener('change', () => {
    const files = Array.from($(input).files); $(input).value = '';
    if (files.length) closeMobileSheet();
    importAssets(files, kind);
  });
}
$('picker-cancel').addEventListener('click', () => $('asset-picker').close());
function syncLibrary(kind, selection, name) {
  const select = $(`${kind}-library`);
  select.querySelector('option[value="local"]')?.remove();
  if (selection === 'local') select.add(new Option(`已导入 · ${name.split('/').pop()}`, 'local'));
  select.value = selection;
}
for (const model of models) $('model-library').add(new Option(model.label, model.id));
for (const group of new Set(motions.map(item => item.group))) {
  const optgroup = document.createElement('optgroup'); optgroup.label = group;
  for (const motion of motions.filter(item => item.group === group)) optgroup.append(new Option(motion.label, motion.id));
  $('motion-library').append(optgroup);
}
async function loadBuiltinModel(model) {
  message(`正在加载 ${model.label}…`);
  const assets = await collectAssets([new File([await bundledAsset(model.path)], 'model.zip')], window.JSZip);
  await loadModel(assets, model.entry, model);
}
async function loadBuiltinMotion(item) {
  message(`正在加载「${item.label}」…`);
  const name = item.path.split('/').pop();
  await loadMotion(new Map([[name, await bundledAsset(item.path)]]), name, item);
}
$('model-library').addEventListener('change', async () => {
  const model = models.find(item => item.id === $('model-library').value);
  if (model) await runImport(() => loadBuiltinModel(model));
  $('model-library').value = modelSelection;
});
$('motion-library').addEventListener('change', async () => {
  const motion = motions.find(item => item.id === $('motion-library').value);
  if (motion) await runImport(() => loadBuiltinMotion(motion));
  $('motion-library').value = motionSelection;
});
$('remove-model').addEventListener('click', () => {
  releaseModel(); $('model-card').hidden = true;
  modelSelection = ''; syncLibrary('model', '', '');
  if (motion) $('motion-detail').textContent = '已就绪，等待导入角色';
  syncTimeline(); refreshControls(); message('角色已移除，可以导入新的角色。');
});
$('remove-motion').addEventListener('click', () => {
  detachAnimation(); mesh?.pose();
  if (mesh?.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
  motion = null; $('motion-card').hidden = true; $('motion-hint').hidden = false;
  motionSelection = ''; syncLibrary('motion', '', '');
  syncTimeline(); refreshControls(); message('动作已移除，角色回到初始姿势。');
});
function toggleCamera() { if (stream) { stopCamera(); message('摄像头已关闭，角色仍可单独拍照。'); } else startCamera(); }
$('camera-toggle').addEventListener('click', toggleCamera);
$('mobile-camera').addEventListener('click', toggleCamera);
function arState(state) {
  const supportText = {
    checking: '正在检查空间 AR 支持…', available: '支持空间 AR：导入角色后，点击取景栏的 AR 即可放到地面或桌面。',
    insecure: '空间 AR 需要 HTTPS；本机可使用 localhost。', unsupported: '此设备未提供空间 AR，可继续使用摄像头叠加与拍照。'
  }[state.support];
  $('ar-support').textContent = supportText;
  $('ar-toggle').title = supportText;
  $('ar-toggle').setAttribute('aria-pressed', String(!!state.active));
  const wasActive = document.body.classList.contains('ar-active');
  document.body.classList.toggle('ar-active', !!state.active);
  $('ar-overlay').hidden = !state.active;
  if (state.active && !wasActive) $('ar-exit').focus({ preventScroll: true });
  $('ar-place').disabled = !state.canPlace || state.phase === 'ending';
  $('ar-reposition').disabled = !state.placed || state.phase === 'ending';
  $('ar-exit').disabled = state.phase === 'ending';
  const hints = {
    searching: '缓慢移动手机，寻找地面或桌面', ready: '找到平面了，点击「放在这里」或轻触画面',
    placed: '角色已放置，移动手机从不同角度看看', 'tracking-lost': '定位暂时丢失，缓慢移动手机以恢复', ending: '正在退出 AR…'
  };
  if (hints[state.phase]) $('ar-status').textContent = hints[state.phase];
  $('ar-height-value').textContent = `${Math.round(state.height * 100)} cm`;
  if (state.phase === 'idle') {
    if (wasActive) { message('已退出 AR，角色与动作已保留。'); $('render-canvas').focus({ preventScroll: true }); }
    lastFrame = performance.now(); resize();
    if (arResumeCamera !== null && !leavingPage) {
      const previous = arResumeCamera; arResumeCamera = null;
      arCameraRestore = startCamera(previous.selection, { mirror: previous.mirror }).finally(() => { arCameraRestore = null; });
    }
  }
  refreshControls();
}
$('ar-toggle').addEventListener('click', async () => {
  if (!spatialAR || spatialAR.locked || busy || cameraPending) return;
  if (spatialAR.support !== 'available') { message($('ar-support').textContent, true); return; }
  if (!mesh) { message('先选择一个内置角色或导入角色，再进入 AR。'); return; }
  closeMobileSheet();
  arResumeCamera = stream ? { selection: cameraController.selection, mirror: $('mirror').checked } : null;
  if (stream) stopCamera();
  message('正在开启 AR，请允许浏览器使用空间定位。');
  try { await spatialAR.start({ height: modelHeight, center: modelCenter, minY: modelMinY }); }
  catch (error) {
    if (arCameraRestore) await arCameraRestore;
    const errors = {
      NotAllowedError: 'AR 权限未获允许，可再次点击 AR 重试。', SecurityError: 'AR 权限被浏览器限制，请使用 HTTPS 并允许空间定位。',
      NotSupportedError: '此设备不支持所需的平面识别或 AR 控件，可继续使用相机叠加。'
    };
    message(errors[error.name] || 'AR 开启失败，已返回相机。请检查设备支持并重试。', true);
  }
});
$('ar-place').addEventListener('click', () => spatialAR?.place());
$('ar-reposition').addEventListener('click', () => spatialAR?.reposition());
$('ar-exit').addEventListener('click', () => spatialAR?.end().catch(() => { $('ar-status').textContent = '请使用浏览器的返回按钮退出 AR。'; $('ar-exit').disabled = false; }));
$('ar-height').addEventListener('input', () => spatialAR?.setHeight(Number($('ar-height').value) / 100));
$('ar-turn-left').addEventListener('click', () => spatialAR?.turn(Math.PI / 12));
$('ar-turn-right').addEventListener('click', () => spatialAR?.turn(-Math.PI / 12));
$('ar-play').addEventListener('click', () => $('play').click());
$('ar-overlay').addEventListener('beforexrselect', event => {
  if (event.target.closest('button, input, label')) event.preventDefault();
});
$('camera-device').addEventListener('change', () => {
  const selection = $('camera-device').value;
  if (stream) startCamera(selection, { strictFacing: true });
  else { cameraController.selection = selection; message('镜头已选择，点击「开启摄像头」开始取景。'); }
});
$('camera-flip').addEventListener('click', () => startCamera(cameraFacing(stream, cameraController.selection) === FRONT_CAMERA ? REAR_CAMERA : FRONT_CAMERA, { strictFacing: true }));
navigator.mediaDevices?.addEventListener('devicechange', () => { if (stream) listCameras().catch(() => {}); });
$('mirror').addEventListener('change', () => $('webcam').classList.toggle('mirrored', $('mirror').checked));
for (const id of ['model-scale', 'model-x', 'model-y']) $(id).addEventListener('input', updateView);
$('reset-view').addEventListener('click', resetView);
$('turn-left').addEventListener('click', () => { modelGroup.rotation.y += Math.PI / 12; });
$('turn-right').addEventListener('click', () => { modelGroup.rotation.y -= Math.PI / 12; });
function changeAspect() {
  const [w, h] = $('aspect').value.split(':').map(Number);
  $('stage').style.aspectRatio = `${w}/${h}`;
  $('stage-shell').classList.toggle('portrait', w < h);
  $('stage-shell').classList.toggle('square', w === h);
  resize();
}
$('aspect').addEventListener('change', changeAspect);
if (mobileLayout.matches) $('aspect').value = window.innerWidth > window.innerHeight ? '16:9' : '9:16';
changeAspect();
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
  if (spatialAR?.locked) return;
  try {
    // Capture entries before awaiting: DataTransfer becomes inaccessible after dispatch.
    const files = event.dataTransfer.items.length ? await droppedFiles(event.dataTransfer.items) : Array.from(event.dataTransfer.files);
    await importAssets(files, 'drop');
  } catch { message('无法读取拖入的文件，请使用导入按钮或文件夹选择。', true); }
});
window.addEventListener('pagehide', event => {
  leavingPage = true; arResumeCamera = null;
  spatialAR?.end().catch(() => {});
  stopCamera(); if (photoURL) URL.revokeObjectURL(photoURL);
  backgroundRequest++;
  if (!event.persisted) {
    backgroundPhoto?.close(); backgroundPhoto = null;
    if (backgroundURL) URL.revokeObjectURL(backgroundURL); backgroundURL = null;
  }
});
window.addEventListener('pageshow', () => { leavingPage = false; });

try {
  renderer = new THREE.WebGLRenderer({ canvas: $('render-canvas'), alpha: true, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  studio = new AnimeRenderer(renderer, scene);
  studio.configure(defaultLighting);
  spatialAR = new SpatialAR({ renderer, scene, camera, model: modelGroup, overlay: $('ar-overlay'), onState: arState });
  spatialAR.detectSupport();
  new ResizeObserver(resize).observe($('stage'));
  resize(); refreshControls(); cameraState(); renderer.setAnimationLoop(tick);
  if (location.protocol !== 'file:') runImport(async () => {
    await loadBuiltinModel(models[0]); await loadBuiltinMotion(motions[0]);
    message('角色与动作已就绪。在选择列表中换一种动作，或开启摄像头开始拍摄。');
  });
  if (location.protocol === 'file:') message('请通过本地服务打开页面：在项目文件夹运行 node XRA_node_server.js。', true);
} catch (error) {
  console.error('MMD Camera renderer:', error);
  $('empty-stage').querySelector('strong').textContent = '当前浏览器无法开启 3D 预览';
  $('empty-stage').querySelector('p').textContent = '请使用支持 WebGL 的浏览器，并开启硬件加速。';
  message('3D 预览初始化失败，请检查浏览器的 WebGL 与硬件加速设置。', true);
  refreshControls(); cameraState();
}
