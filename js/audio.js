// Sound-track playback. Deliberately just a plain <audio> element rather than
// Web Audio API buffers — decoding a whole file into an AudioBuffer costs
// real memory and CPU, and we don't need sample-accurate mixing, just
// "play/pause/seek in sync with the timeline". The browser streams/decodes
// the native element for us, which is far cheaper on low-memory devices.

import { getAsset } from './store.js';

let el = null;
function ensureEl() {
  if (!el) { el = new Audio(); el.preload = 'auto'; }
  return el;
}

// Probe a just-uploaded file's duration (ms) before it's attached to the doc.
export function probeAudioDuration(dataUrl) {
  return new Promise(resolve => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : 5000);
    a.onerror = () => resolve(5000); // best-effort fallback so upload never hard-fails
    a.src = dataUrl;
  });
}

const RESYNC_THRESHOLD_PLAYING = 0.15; // seconds of drift tolerated before a hard seek
const RESYNC_THRESHOLD_PAUSED = 0.03;

// Called every rAF frame from viewport.js. Cheap no-op when there's no track.
export function syncAudio(doc, timeMs, playing) {
  const a = doc.audio;
  const audioEl = ensureEl();
  if (!a) { if (!audioEl.paused) audioEl.pause(); return; }

  const asset = getAsset(a.assetId);
  if (!asset) return;
  if (audioEl.dataset.assetId !== a.assetId) {
    audioEl.src = asset.data;
    audioEl.dataset.assetId = a.assetId;
  }
  audioEl.volume = a.volume ?? 1;

  const clipLen = a.trimEnd - a.trimStart;
  const localT = timeMs - (a.offset || 0);
  if (localT < 0 || localT > clipLen) {
    if (!audioEl.paused) audioEl.pause();
    return;
  }
  const wantSrcTime = (a.trimStart + localT) / 1000;
  if (playing) {
    if (audioEl.paused) audioEl.play().catch(() => {});
    if (Math.abs(audioEl.currentTime - wantSrcTime) > RESYNC_THRESHOLD_PLAYING) audioEl.currentTime = wantSrcTime;
  } else {
    if (!audioEl.paused) audioEl.pause();
    if (Math.abs(audioEl.currentTime - wantSrcTime) > RESYNC_THRESHOLD_PAUSED) audioEl.currentTime = wantSrcTime;
  }
}
