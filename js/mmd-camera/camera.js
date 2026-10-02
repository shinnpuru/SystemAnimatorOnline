export const REAR_CAMERA = 'environment';
export const FRONT_CAMERA = 'user';
export const deviceCamera = id => `device:${id}`;

export function cameraConstraints(selection = REAR_CAMERA, strictFacing = false) {
  const source = selection.startsWith('device:')
    ? { deviceId: { exact: selection.slice(7) } }
    : { facingMode: { [strictFacing ? 'exact' : 'ideal']: selection === FRONT_CAMERA ? FRONT_CAMERA : REAR_CAMERA } };
  return { audio: false, video: { ...source, width: { ideal: 1920 }, height: { ideal: 1080 } } };
}

export function cameraFacing(stream, selection) {
  const facing = stream?.getVideoTracks()[0]?.getSettings().facingMode;
  return facing || (selection === FRONT_CAMERA || selection === REAR_CAMERA ? selection : '');
}

function release(stream) { for (const track of stream?.getTracks() || []) track.stop(); }
const cancelled = () => new DOMException('Camera request cancelled', 'AbortError');

// Phones may allow only one camera capture at a time. Release the old stream
// BEFORE opening the next camera, and reacquire it if switching fails.
export class CameraController {
  constructor({ mediaDevices, video, onState = () => {}, onEnded = () => {}, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    Object.assign(this, { mediaDevices, video, onState, onEnded, delay });
    this.stream = null; this.candidate = null; this.pending = false;
    this.selection = REAR_CAMERA; this.generation = 0;
  }

  emit() { this.onState({ stream: this.stream, pending: this.pending, selection: this.selection }); }

  stop() {
    this.generation++;
    const stream = this.stream, candidate = this.candidate;
    this.stream = null; this.candidate = null; this.pending = false;
    this.video.srcObject = null;
    release(stream); if (candidate !== stream) release(candidate);
    this.emit();
  }

  async acquire(selection, generation, strictFacing, retryBusy) {
    let acquired;
    try {
      try { acquired = await this.mediaDevices.getUserMedia(cameraConstraints(selection, strictFacing)); }
      catch (error) {
        if (!retryBusy || !['NotReadableError', 'AbortError'].includes(error.name) || generation !== this.generation) throw error;
        // Some mobile drivers need a short moment to release capture hardware.
        await this.delay(180);
        if (generation !== this.generation) throw cancelled();
        acquired = await this.mediaDevices.getUserMedia(cameraConstraints(selection, strictFacing));
      }
      if (generation !== this.generation) throw cancelled();
      this.candidate = acquired;
      this.video.srcObject = acquired;
      await this.video.play();
      if (generation !== this.generation) throw cancelled();
      const track = acquired.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new DOMException('Camera ended', 'NotReadableError');
      this.stream = acquired; this.candidate = null;
      // An ideal rear request may fall back on a computer with only a webcam.
      this.selection = !selection.startsWith('device:') && ['user', 'environment'].includes(track.getSettings().facingMode)
        ? track.getSettings().facingMode : selection;
      track.addEventListener('ended', () => {
        if (this.stream !== acquired) return;
        this.stop(); this.onEnded();
      });
      return acquired;
    } catch (error) {
      release(acquired);
      if (this.candidate === acquired) this.candidate = null;
      if (this.video.srcObject === acquired) this.video.srcObject = null;
      throw error;
    }
  }

  async start(selection = this.selection, { strictFacing = false } = {}) {
    if (this.pending) return { busy: true };
    const generation = ++this.generation;
    const previous = this.stream;
    const previousSelection = this.selection;
    const previousId = previous?.getVideoTracks()[0]?.getSettings().deviceId;
    this.pending = true; this.stream = null; this.video.srcObject = null;
    release(previous); this.emit();
    try {
      const stream = await this.acquire(selection, generation, strictFacing, !!previous);
      return { stream };
    } catch (error) {
      if (generation !== this.generation) return { cancelled: true };
      let restored = false;
      // Do not prompt again after a permission refusal or page exit.
      if (previous && !['NotAllowedError', 'SecurityError'].includes(error.name)) {
        try {
          await this.acquire(previousId ? deviceCamera(previousId) : previousSelection, generation, false, true);
          if (generation !== this.generation) return { cancelled: true };
          this.selection = previousSelection; restored = true;
        } catch { if (generation !== this.generation) return { cancelled: true }; }
      }
      return { error, restored };
    } finally {
      if (generation === this.generation) { this.pending = false; this.emit(); }
    }
  }
}
