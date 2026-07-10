// MP4 via WebCodecs + mp4-muxer; falls back to WebM via MediaRecorder.

import { sequenceFrames, staticSize } from './index.js';
import { state } from '../store.js';
import { renderFrame } from '../render.js';

export async function exportVideo(opts, onProgress) {
  if ('VideoEncoder' in window) {
    try {
      return { blob: await exportMp4(opts, onProgress), ext: 'mp4' };
    } catch (err) {
      console.warn('MP4 path failed, falling back to WebM:', err);
    }
  }
  return { blob: await exportWebm(opts, onProgress), ext: 'webm' };
}

async function exportMp4(opts, onProgress) {
  const { Muxer, ArrayBufferTarget } = await import('https://esm.sh/mp4-muxer@5.2.1');
  let { w, h } = staticSize(opts.scale);
  // H.264 requires even dimensions.
  w += w % 2; h += h % 2;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { throw e; },
  });
  encoder.configure({
    codec: 'avc1.42003e',
    width: w, height: h,
    bitrate: Math.min(20_000_000, Math.max(2_000_000, w * h * 6)),
    framerate: opts.fps,
  });

  const pad = document.createElement('canvas');
  pad.width = w; pad.height = h;
  const pctx = pad.getContext('2d');

  await sequenceFrames({
    ...opts,
    transparent: false,
    onFrame: async ({ canvas, index }) => {
      pctx.fillStyle = state.doc.grid.bg;
      pctx.fillRect(0, 0, w, h);
      pctx.drawImage(canvas, 0, 0);
      const frame = new VideoFrame(pad, { timestamp: Math.round(index * 1e6 / opts.fps), duration: Math.round(1e6 / opts.fps) });
      encoder.encode(frame, { keyFrame: index % 60 === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 8) await encoder.flush();
    },
    onProgress: p => onProgress(p * 0.9),
  });

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  onProgress(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

async function exportWebm(opts, onProgress) {
  const { w, h } = staticSize(opts.scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('This browser supports neither WebCodecs nor WebM recording');
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = r; });
  rec.start();

  // Real-time playback into the recorder (MediaRecorder is wall-clock based).
  const doc = state.doc;
  const frameDur = 1000 / opts.fps;
  const count = Math.max(1, Math.round((opts.duration / 1000) * opts.fps));
  for (let i = 0; i < count; i++) {
    renderFrame(ctx, doc, i * frameDur, { scale: opts.scale, transparent: false });
    if (track.requestFrame) track.requestFrame();
    onProgress((i + 1) / count);
    await new Promise(r => setTimeout(r, frameDur));
  }
  rec.stop();
  await done;
  return new Blob(chunks, { type: 'video/webm' });
}
