// Export dialog + frame sequencer. All exporters consume frames rendered by
// the same renderFrame used for the live preview.

import { el, button, select, numInput, row, modal, toast, segmented } from '../ui/components.js';
import { state } from '../store.js';
import { gridSizePx } from '../model.js';
import { renderFrame } from '../render.js';
import { exportGif } from './gif.js';
import { exportZip } from './zip.js';
import { exportVideo } from './video.js';
import { exportSvg } from './svg.js';
import { downloadBlob } from '../ui/panels.js';

// Render every frame of the animation to an offscreen canvas, yielding
// { canvas, ctx, index, t } via the callback. Returns frame count.
export async function sequenceFrames({ scale, fps, duration, transparent, onFrame, onProgress }) {
  const doc = state.doc;
  const { w, h } = gridSizePx(doc.grid);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const count = Math.max(1, Math.round((duration / 1000) * fps));
  for (let i = 0; i < count; i++) {
    const t = (i / fps) * 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderFrame(ctx, doc, t, { scale, transparent });
    await onFrame({ canvas, ctx, index: i, t, count });
    if (onProgress) onProgress((i + 1) / count);
    if (i % 8 === 7) await new Promise(r => setTimeout(r)); // keep UI alive
  }
  return count;
}

export function staticSize(scale) {
  const { w, h } = gridSizePx(state.doc.grid);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

const FORMATS = [
  ['gif', 'GIF (animated)'],
  ['mp4', 'MP4 / WebM video'],
  ['zip-png', 'Frames → PNG (.zip)'],
  ['zip-jpeg', 'Frames → JPEG (.zip)'],
  ['png', 'PNG (current frame)'],
  ['svg', 'SVG (static)'],
  ['svg-anim', 'SVG (animated)'],
];

export function openExportDialog() {
  const opts = {
    format: 'gif',
    scale: 2,
    fps: state.doc.animation.fps,
    duration: state.doc.animation.duration,
    transparent: false,
  };

  let progressBar, progressWrap, exportBtn;

  const body = el('div', {});

  function rebuild() {
    body.innerHTML = '';
    const { w, h } = staticSize(opts.scale);
    const animated = !['png', 'svg'].includes(opts.format);
    const supportsTransparent = ['png', 'zip-png', 'gif', 'svg', 'svg-anim'].includes(opts.format);

    body.append(
      row('Format', select(opts.format, FORMATS, v => { opts.format = v; rebuild(); })),
      row('Scale', segmented(String(opts.scale), [['1', '1×'], ['2', '2×'], ['4', '4×'], ['8', '8×']], v => { opts.scale = +v; rebuild(); })),
      el('div', { class: 'text-[11px] text-muted mb-2 text-right font-mono' }, `${w} × ${h}px`),
    );
    if (animated) {
      body.append(
        row('FPS', numInput(opts.fps, v => { opts.fps = v; }, { min: 5, max: 60 })),
        row('Duration', numInput(opts.duration / 1000, v => { opts.duration = v * 1000; }, { min: 0.2, max: 60, step: 0.1, suffix: 's' })),
      );
    }
    if (supportsTransparent) {
      body.append(row('Background', segmented(opts.transparent ? 'clear' : 'bg', [['bg', 'Color'], ['clear', 'Transparent']], v => { opts.transparent = v === 'clear'; })));
    }
    progressWrap = el('div', { class: 'mt-3 hidden' },
      el('div', { class: 'h-1.5 bg-ink-3 rounded overflow-hidden' },
        progressBar = el('div', { class: 'h-full bg-accent rounded transition-all', style: 'width:0%' })),
      el('div', { class: 'text-[11px] text-muted mt-1.5 text-center' }, 'Rendering…'));
    body.append(progressWrap);
  }
  rebuild();

  const close = modal('Export', body, {
    actions: [
      button('Cancel', () => close(), { variant: 'outline' }),
      exportBtn = button('Export', () => run(), { variant: 'primary' }),
    ],
  });

  async function run() {
    exportBtn.disabled = true;
    exportBtn.style.opacity = '0.5';
    progressWrap.classList.remove('hidden');
    const onProgress = p => { progressBar.style.width = (p * 100).toFixed(1) + '%'; };
    const name = state.projectName.replace(/\s+/g, '-').toLowerCase() || 'dotmatrix';
    try {
      switch (opts.format) {
        case 'gif': downloadBlob(await exportGif(opts, onProgress), `${name}.gif`); break;
        case 'mp4': {
          const { blob, ext } = await exportVideo(opts, onProgress);
          downloadBlob(blob, `${name}.${ext}`);
          break;
        }
        case 'zip-png': downloadBlob(await exportZip({ ...opts, type: 'png' }, onProgress), `${name}-frames-png.zip`); break;
        case 'zip-jpeg': downloadBlob(await exportZip({ ...opts, type: 'jpeg' }, onProgress), `${name}-frames-jpeg.zip`); break;
        case 'png': {
          const { w, h } = staticSize(opts.scale);
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          renderFrame(c.getContext('2d'), state.doc, state.ui.time, { scale: opts.scale, transparent: opts.transparent });
          downloadBlob(await new Promise(r => c.toBlob(r, 'image/png')), `${name}.png`);
          break;
        }
        case 'svg': downloadBlob(exportSvg({ animated: false, transparent: opts.transparent }), `${name}.svg`); break;
        case 'svg-anim': downloadBlob(exportSvg({ animated: true, transparent: opts.transparent, duration: opts.duration }), `${name}-animated.svg`); break;
      }
      toast('Export complete');
      close();
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + (err.message || err));
      exportBtn.disabled = false;
      exportBtn.style.opacity = '';
      progressWrap.classList.add('hidden');
    }
  }
}
