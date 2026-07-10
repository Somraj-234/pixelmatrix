// All frames as PNG/JPEG in a ZIP, via JSZip (CDN).

import { sequenceFrames } from './index.js';

const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

let libPromise = null;
function loadLib() {
  if (!libPromise) {
    libPromise = new Promise((res, rej) => {
      if (window.JSZip) return res();
      const s = document.createElement('script');
      s.src = JSZIP;
      s.onload = res;
      s.onerror = () => rej(new Error('Could not load JSZip from CDN'));
      document.head.append(s);
    });
  }
  return libPromise;
}

export async function exportZip(opts, onProgress) {
  await loadLib();
  const zip = new window.JSZip();
  const mime = opts.type === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = opts.type === 'jpeg' ? 'jpg' : 'png';

  const total = Math.max(1, Math.round((opts.duration / 1000) * opts.fps));
  const padWidth = String(total).length;

  await sequenceFrames({
    ...opts,
    // JPEG has no alpha — force background.
    transparent: opts.type === 'jpeg' ? false : opts.transparent,
    onFrame: async ({ canvas, index }) => {
      const blob = await new Promise(r => canvas.toBlob(r, mime, 0.92));
      zip.file(`frame-${String(index + 1).padStart(padWidth, '0')}.${ext}`, blob);
    },
    onProgress: p => onProgress(p * 0.8),
  });

  return zip.generateAsync({ type: 'blob' }, meta => onProgress(0.8 + meta.percent / 100 * 0.2));
}
