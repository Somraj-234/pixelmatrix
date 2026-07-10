// GIF export via gif.js (loaded from CDN; worker fetched and blob-ified for CORS).

import { sequenceFrames } from './index.js';

const GIF_JS = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js';
const GIF_WORKER = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js';

let libPromise = null;
function loadLib() {
  if (!libPromise) {
    libPromise = (async () => {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = GIF_JS;
        s.onload = res;
        s.onerror = () => rej(new Error('Could not load gif.js from CDN'));
        document.head.append(s);
      });
      const workerSrc = await (await fetch(GIF_WORKER)).text();
      return URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }));
    })();
  }
  return libPromise;
}

export async function exportGif(opts, onProgress) {
  const workerUrl = await loadLib();
  const gif = new window.GIF({
    workers: 2,
    quality: 8,
    workerScript: workerUrl,
    transparent: opts.transparent ? 0x00FF00FF : null,
  });

  await sequenceFrames({
    ...opts,
    onFrame: ({ canvas }) => {
      gif.addFrame(canvas, { copy: true, delay: Math.round(1000 / opts.fps) });
    },
    onProgress: p => onProgress(p * 0.5),
  });

  return new Promise((resolve, reject) => {
    gif.on('progress', p => onProgress(0.5 + p * 0.5));
    gif.on('finished', blob => resolve(blob));
    gif.on('abort', () => reject(new Error('GIF encoding aborted')));
    gif.render();
  });
}
