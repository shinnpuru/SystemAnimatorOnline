import * as THREE from './vendor/three.module.min.js';

// Port the upstream MMD_SA.WebXR flow to this app's renderer: viewer-space
// hit tests, a ground reticle, optional anchors, and restoration on session end.
// See MMD.js/MMD_SA.js: WebXR.hit_test, update_anchor and onSessionEnd.
export function groundMatrix(pose) {
  const values = pose?.transform?.matrix;
  if (!values || values.length !== 16 || !Array.from(values).every(Number.isFinite)) return null;
  const matrix = new THREE.Matrix4().fromArray(values);
  const normal = new THREE.Vector3().setFromMatrixColumn(matrix, 1).normalize();
  // Keep characters upright. Walls, ceilings and steep slopes are not placements.
  return normal.y >= .75 ? matrix : null;
}

function yaw(matrix) {
  const forward = new THREE.Vector3().setFromMatrixColumn(matrix, 2);
  return Math.atan2(forward.x, forward.z);
}

function release(resource, method) { try { resource?.[method](); } catch {} }

export class SpatialAR {
  constructor({ renderer, scene, camera, model, overlay, onState = () => {}, xr = globalThis.navigator?.xr, secure = globalThis.isSecureContext }) {
    Object.assign(this, { renderer, scene, camera, model, overlay, onState, xr, secure });
    this.support = 'checking'; this.phase = 'idle';
    this.session = null; this.source = null; this.anchor = null;
    this.placed = false; this.height = 1.2; this.generation = 0; this.placement = 0;
    this.root = new THREE.Group(); this.root.visible = false;
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(.1, .11, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xdbe8b1, side: THREE.DoubleSide, depthTest: false })
    );
    this.reticle.matrixAutoUpdate = false; this.reticle.visible = false;
    scene.add(this.root, this.reticle);
  }

  get active() { return !!(this.session && this.prepared && this.phase !== 'starting'); }
  get locked() { return this.phase !== 'idle'; }
  get canPlace() { return this.active && this.phase !== 'ending' && !this.placed && this.reticle.visible; }

  emit(phase = this.phase) {
    this.phase = phase;
    this.onState({ phase, support: this.support, active: this.active, placed: this.placed, canPlace: this.canPlace, height: this.height });
  }

  async detectSupport() {
    if (!this.secure) this.support = 'insecure';
    else if (!this.xr?.isSessionSupported) this.support = 'unsupported';
    else {
      try { this.support = await this.xr.isSessionSupported('immersive-ar') ? 'available' : 'unsupported'; }
      catch { this.support = 'unsupported'; }
    }
    this.emit();
    return this.support;
  }

  async start({ height, center, minY }) {
    if (this.locked) return false;
    if (this.support !== 'available') throw new Error('AR unavailable');
    const generation = ++this.generation;
    this.emit('starting');
    let session;
    try {
      // Call directly from the entry button, before any await loses activation.
      session = await this.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'], optionalFeatures: ['anchors'],
        domOverlay: { root: this.overlay }
      });
      if (generation !== this.generation) { await session.end(); return false; }
      this.session = session;
      let ended = false;
      this.onEnd = () => {
        ended = true;
        // Three.js must finish releasing its XR framebuffer before preview resize.
        queueMicrotask(() => this.finish(session));
      };
      session.addEventListener('end', this.onEnd);
      const viewer = await session.requestReferenceSpace('viewer');
      if (ended || this.session !== session) return false;
      const source = await session.requestHitTestSource({ space: viewer });
      if (ended || this.session !== session) { source.cancel(); return false; }
      this.source = source;
      this.saved = {
        parent: this.model.parent, position: this.model.position.clone(),
        quaternion: this.model.quaternion.clone(), scale: this.model.scale.clone(),
        visible: this.model.visible, camera: this.camera.clone()
      };
      this.modelHeight = Math.max(height, .001);
      this.heading = this.model.rotation.y;
      this.root.add(this.model);
      this.model.position.set(-center.x, -minY, -center.z);
      this.model.quaternion.identity(); this.model.scale.setScalar(1);
      this.root.scale.setScalar(this.height / this.modelHeight);
      this.camera.position.set(0, 0, 0); this.camera.quaternion.identity();
      this.camera.near = .01; this.camera.far = 50; this.camera.updateProjectionMatrix();
      this.prepared = true;
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType('local');
      await this.renderer.xr.setSession(session);
      if (ended || this.session !== session) return false;
      this.onSelect = () => this.place();
      session.addEventListener('select', this.onSelect);
      this.referenceSpace = this.renderer.xr.getReferenceSpace();
      this.onReset = () => { if (!this.anchor) this.reposition(); };
      this.referenceSpace.addEventListener?.('reset', this.onReset);
      this.emit('searching');
      return true;
    } catch (error) {
      if (session) { try { await session.end(); } catch {} }
      if (this.generation === generation || (session && this.session === session)) this.finish(session);
      throw error;
    }
  }

  update(frame) {
    if (!this.active || frame?.session !== this.session) return;
    const reference = this.renderer.xr.getReferenceSpace();
    const viewer = frame.getViewerPose(reference);
    if (!viewer) {
      this.reticle.visible = false; this.root.visible = false;
      if (this.phase !== 'tracking-lost') this.emit('tracking-lost');
      return;
    }
    this.viewerPosition = new THREE.Vector3().copy(viewer.transform.position);
    if (this.placed) {
      if (this.anchor) {
        const pose = (!frame.trackedAnchors || frame.trackedAnchors.has(this.anchor)) && frame.getPose(this.anchor.anchorSpace, reference);
        if (!pose) {
          this.root.visible = false;
          if (this.phase !== 'tracking-lost') this.emit('tracking-lost');
          return;
        }
        const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
        this.root.position.setFromMatrixPosition(matrix);
        this.surfaceYaw = yaw(matrix);
        this.updateHeading();
      }
      this.root.visible = true;
      if (this.phase !== 'placed') this.emit('placed');
      return;
    }
    this.reticle.visible = false;
    for (const hit of frame.getHitTestResults(this.source)) {
      const matrix = groundMatrix(hit.getPose(reference));
      if (!matrix) continue;
      this.reticle.matrix.copy(matrix); this.reticle.visible = true;
      if (this.wantPlacement) this.commitPlacement(hit, matrix);
      break;
    }
    const phase = this.placed ? 'placed' : this.reticle.visible ? 'ready' : 'searching';
    if (phase !== this.phase) this.emit(phase);
  }

  place() {
    if (!this.canPlace) return false;
    // XRHitTestResult.createAnchor must run during an active XR animation frame.
    this.wantPlacement = true;
    return true;
  }

  commitPlacement(hit, matrix) {
    this.wantPlacement = false; this.placed = true;
    this.root.position.setFromMatrixPosition(matrix);
    const facing = this.viewerPosition.clone().sub(this.root.position);
    this.surfaceYaw = yaw(matrix);
    this.facingOffset = Math.atan2(facing.x, facing.z) - this.surfaceYaw;
    this.updateHeading();
    this.root.visible = true; this.reticle.visible = false;
    const session = this.session, placement = ++this.placement;
    if (hit.createAnchor) {
      try {
        hit.createAnchor().then(anchor => {
          if (this.session !== session || this.placement !== placement || !this.placed) release(anchor, 'delete');
          else this.anchor = anchor;
        }).catch(() => {}); // Optional anchors: local-space placement remains valid.
      } catch {} // Some devices expose createAnchor without granting the feature.
    }
  }

  updateHeading() { this.root.rotation.set(0, this.surfaceYaw + this.facingOffset + this.heading, 0); }
  turn(radians) { if (this.active) { this.heading += radians; if (this.placed) this.updateHeading(); } }
  setHeight(meters) {
    this.height = THREE.MathUtils.clamp(meters, .2, 2.2);
    if (this.prepared) this.root.scale.setScalar(this.height / this.modelHeight);
    this.emit();
  }

  reposition() {
    if (!this.active) return;
    this.placement++; release(this.anchor, 'delete'); this.anchor = null;
    this.placed = false; this.wantPlacement = false;
    this.root.visible = false; this.reticle.visible = false;
    this.emit('searching');
  }

  async end() {
    const session = this.session;
    if (!session) {
      if (this.locked) { this.generation++; this.finish(); }
      return;
    }
    this.emit('ending');
    await session.end();
    this.finish(session);
  }

  finish(session) {
    if (session && this.session !== session) return;
    if (!this.locked && !this.saved) return;
    this.generation++; this.placement++;
    release(this.source, 'cancel'); this.source = null;
    release(this.anchor, 'delete'); this.anchor = null;
    this.session?.removeEventListener('end', this.onEnd);
    if (this.onSelect) this.session?.removeEventListener('select', this.onSelect);
    this.referenceSpace?.removeEventListener?.('reset', this.onReset);
    this.referenceSpace = null;
    this.session = null; this.placed = false; this.wantPlacement = false;
    this.root.visible = false; this.reticle.visible = false;
    if (this.saved) {
      const saved = this.saved;
      (saved.parent || this.scene).add(this.model);
      this.model.position.copy(saved.position); this.model.quaternion.copy(saved.quaternion);
      this.model.scale.copy(saved.scale); this.model.visible = saved.visible;
      this.camera.copy(saved.camera, false);
      this.saved = null;
    }
    this.prepared = false;
    this.emit('idle');
  }
}
